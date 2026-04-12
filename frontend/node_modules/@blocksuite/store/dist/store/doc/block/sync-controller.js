import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import { effect, signal } from '@preact/signals-core';
import { createMutex } from 'lib0/mutex.js';
import * as Y from 'yjs';
import { Boxed, createYProxy, native2Y, y2Native, } from '../../../reactive/index.js';
import { BlockModel, internalPrimitives } from '../../../schema/base.js';
/**
 * @internal
 * SyncController is responsible for syncing the block data with Yjs.
 * It creates a proxy model that syncs with Yjs and provides a reactive interface.
 * It also handles the stashing and popping of props.
 * It will also provide signals for block props.
 *
 */
export class SyncController {
    constructor(schema, yBlock, doc, onChange) {
        this.schema = schema;
        this.yBlock = yBlock;
        this.doc = doc;
        this.onChange = onChange;
        this._byPassProxy = false;
        this._byPassUpdate = (fn) => {
            this._byPassProxy = true;
            fn();
            this._byPassProxy = false;
        };
        this._mutex = createMutex();
        this._observeYBlockChanges = () => {
            this.yBlock.observe(event => {
                event.keysChanged.forEach(key => {
                    const type = event.changes.keys.get(key);
                    if (!type) {
                        return;
                    }
                    if (type.action === 'update' || type.action === 'add') {
                        const value = this.yBlock.get(key);
                        const keyName = key.replace('prop:', '');
                        const proxy = this._getPropsProxy(keyName, value);
                        this._byPassUpdate(() => {
                            // @ts-ignore
                            this.model[keyName] = proxy;
                            const signalKey = `${keyName}$`;
                            this._mutex(() => {
                                // @ts-ignore
                                if (signalKey in this.model) {
                                    // @ts-ignore
                                    this.model[signalKey].value = y2Native(value);
                                }
                            });
                        });
                        this.onChange?.(keyName, value);
                        return;
                    }
                    if (type.action === 'delete') {
                        const keyName = key.replace('prop:', '');
                        this._byPassUpdate(() => {
                            // @ts-ignore
                            delete this.model[keyName];
                            // @ts-ignore
                            if (`${keyName}$` in this.model) {
                                // @ts-ignore
                                this.model[`${keyName}$`].value = undefined;
                            }
                        });
                        this.onChange?.(keyName, undefined);
                        return;
                    }
                });
            });
        };
        this._stashed = new Set();
        this.pop = (prop) => {
            if (!this._stashed.has(prop))
                return;
            this._popProp(prop);
        };
        this.stash = (prop) => {
            if (this._stashed.has(prop))
                return;
            this._stashed.add(prop);
            this._stashProp(prop);
        };
        const { id, flavour, version, yChildren, props } = this._parseYBlock();
        this.id = id;
        this.flavour = flavour;
        this.yChildren = yChildren;
        this.version = version;
        this.model = this._createModel(props);
        this._observeYBlockChanges();
    }
    _createModel(props) {
        const _mutex = this._mutex;
        const schema = this.schema.flavourSchemaMap.get(this.flavour);
        if (!schema) {
            throw new BlockSuiteError(ErrorCode.ModelCRUDError, `schema for flavour: ${this.flavour} not found`);
        }
        const model = schema.model.toModel?.() ?? new BlockModel();
        const signalWithProps = Object.entries(props).reduce((acc, [key, value]) => {
            const data = signal(value);
            const dispose = effect(() => {
                const value = data.value;
                if (!this.model)
                    return;
                _mutex(() => {
                    // @ts-ignore
                    this.model[key] = value;
                });
            });
            model.deleted.once(dispose);
            return {
                ...acc,
                [`${key}$`]: data,
                [key]: value,
            };
        }, {});
        Object.assign(model, signalWithProps);
        model.id = this.id;
        model.version = this.version;
        model.keys = Object.keys(props);
        model.flavour = schema.model.flavour;
        model.role = schema.model.role;
        model.yBlock = this.yBlock;
        model.stash = this.stash;
        model.pop = this.pop;
        if (this.doc) {
            model.doc = this.doc;
        }
        const proxy = new Proxy(model, {
            has: (target, p) => {
                return Reflect.has(target, p);
            },
            set: (target, p, value, receiver) => {
                if (!this._byPassProxy &&
                    typeof p === 'string' &&
                    model.keys.includes(p)) {
                    if (this._stashed.has(p)) {
                        setValue(target, p, value);
                        const result = Reflect.set(target, p, value, receiver);
                        this.onChange?.(p, value);
                        return result;
                    }
                    const yValue = native2Y(value);
                    this.yBlock.set(`prop:${p}`, yValue);
                    const proxy = this._getPropsProxy(p, yValue);
                    setValue(target, p, value);
                    return Reflect.set(target, p, proxy, receiver);
                }
                return Reflect.set(target, p, value, receiver);
            },
            get: (target, p, receiver) => {
                return Reflect.get(target, p, receiver);
            },
            deleteProperty: (target, p) => {
                if (!this._byPassProxy &&
                    typeof p === 'string' &&
                    model.keys.includes(p)) {
                    this.yBlock.delete(`prop:${p}`);
                    setValue(target, p, undefined);
                }
                return Reflect.deleteProperty(target, p);
            },
        });
        function setValue(target, p, value) {
            _mutex(() => {
                // @ts-ignore
                target[`${p}$`].value = value;
            });
        }
        return proxy;
    }
    _getPropsProxy(name, value) {
        return createYProxy(value, {
            onChange: () => {
                this.onChange?.(name, value);
                const signalKey = `${name}$`;
                if (signalKey in this.model) {
                    this._mutex(() => {
                        // @ts-ignore
                        this.model[signalKey].value = this.model[name];
                    });
                }
            },
        });
    }
    _parseYBlock() {
        let id;
        let flavour;
        let version;
        let yChildren;
        const props = {};
        this.yBlock.forEach((value, key) => {
            if (key.startsWith('prop:')) {
                const keyName = key.replace('prop:', '');
                props[keyName] = this._getPropsProxy(keyName, value);
                return;
            }
            if (key === 'sys:id' && typeof value === 'string') {
                id = value;
                return;
            }
            if (key === 'sys:flavour' && typeof value === 'string') {
                flavour = value;
                return;
            }
            if (key === 'sys:children' && value instanceof Y.Array) {
                yChildren = value;
                return;
            }
            if (key === 'sys:version' && typeof value === 'number') {
                version = value;
                return;
            }
        });
        if (!id) {
            throw new BlockSuiteError(ErrorCode.ModelCRUDError, 'block id is not found when creating model');
        }
        if (!flavour) {
            throw new BlockSuiteError(ErrorCode.ModelCRUDError, 'block flavour is not found when creating model');
        }
        if (!yChildren) {
            throw new BlockSuiteError(ErrorCode.ModelCRUDError, 'block children is not found when creating model');
        }
        const schema = this.schema.flavourSchemaMap.get(flavour);
        if (!schema) {
            throw new BlockSuiteError(ErrorCode.ModelCRUDError, `schema for flavour: ${flavour} not found`);
        }
        const defaultProps = schema.model.props?.(internalPrimitives);
        if (typeof version !== 'number') {
            // no version found in data, set to schema version
            version = schema.version;
        }
        // Set default props if not exists
        if (defaultProps) {
            Object.entries(defaultProps).forEach(([key, value]) => {
                if (key in props)
                    return;
                const yValue = native2Y(value);
                this.yBlock.set(`prop:${key}`, yValue);
                props[key] = this._getPropsProxy(key, yValue);
            });
        }
        return {
            id,
            flavour,
            version,
            props,
            yChildren,
        };
    }
    _popProp(prop) {
        const model = this.model;
        const value = model[prop];
        this._stashed.delete(prop);
        model[prop] = value;
    }
    _stashProp(prop) {
        this.model[prop] = y2Native(this.yBlock.get(`prop:${prop}`), {
            transform: (value, origin) => {
                if (Boxed.is(origin)) {
                    return value;
                }
                if (origin instanceof Y.Map) {
                    return new Proxy(value, {
                        get: (target, p, receiver) => {
                            return Reflect.get(target, p, receiver);
                        },
                        set: (target, p, value, receiver) => {
                            const result = Reflect.set(target, p, value, receiver);
                            this.onChange?.(prop, value);
                            return result;
                        },
                        deleteProperty: (target, p) => {
                            const result = Reflect.deleteProperty(target, p);
                            this.onChange?.(prop, undefined);
                            return result;
                        },
                    });
                }
                if (origin instanceof Y.Array) {
                    return new Proxy(value, {
                        get: (target, p, receiver) => {
                            return Reflect.get(target, p, receiver);
                        },
                        set: (target, p, value, receiver) => {
                            const index = Number(p);
                            if (Number.isNaN(index)) {
                                return Reflect.set(target, p, value, receiver);
                            }
                            const result = Reflect.set(target, p, value, receiver);
                            this.onChange?.(prop, value);
                            return result;
                        },
                        deleteProperty: (target, p) => {
                            const result = Reflect.deleteProperty(target, p);
                            this.onChange?.(p, undefined);
                            return result;
                        },
                    });
                }
                return value;
            },
        });
    }
}
//# sourceMappingURL=sync-controller.js.map