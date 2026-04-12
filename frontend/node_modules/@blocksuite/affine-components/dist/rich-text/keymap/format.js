import { textFormatConfigs } from '../format/index.js';
export const textFormatKeymap = (std) => textFormatConfigs
    .filter(config => config.hotkey)
    .reduce((acc, config) => {
    return {
        ...acc,
        [config.hotkey]: ctx => {
            const { doc, selection } = std;
            if (doc.readonly)
                return;
            const textSelection = selection.find('text');
            if (!textSelection)
                return;
            config.action(std.host);
            ctx.get('keyboardState').raw.preventDefault();
            return true;
        },
    };
}, {});
//# sourceMappingURL=format.js.map