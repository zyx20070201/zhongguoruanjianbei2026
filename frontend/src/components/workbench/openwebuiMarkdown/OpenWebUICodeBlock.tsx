import { acceptCompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

interface OpenWebUICodeBlockProps {
  id: string;
  code: string;
  lang?: string;
  raw?: string;
  collapsedDefault?: boolean;
  editable?: boolean;
  highlighted?: boolean;
}

interface OpenWebUICodeEditorProps {
  id: string;
  code: string;
  lang: string;
  editable: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

function findChanges(oldStr: string, newStr: string) {
  let start = 0;
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
    start++;
  }
  if (oldStr === newStr) return [];

  let endOld = oldStr.length;
  let endNew = newStr.length;
  while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) {
    endOld--;
    endNew--;
  }

  return [
    {
      from: start,
      to: endOld,
      insert: newStr.slice(start, endNew)
    }
  ];
}

function OpenWebUICodeEditor({ code, lang, editable, onChange, onSave }: OpenWebUICodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const languageCompartment = useMemo(() => new Compartment(), []);
  const editableCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    codeRef.current = code;

    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          keymap.of([
            { key: 'Tab', run: acceptCompletion },
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                onSaveRef.current();
                return true;
              }
            }
          ]),
          indentUnit.of('    '),
          placeholder('Enter your code here...'),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const nextValue = update.state.doc.toString();
            codeRef.current = nextValue;
            onChangeRef.current(nextValue);
          }),
          editableCompartment.of(EditorView.editable.of(editable)),
          languageCompartment.of([])
        ]
      }),
      parent: hostRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editableCompartment, languageCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (codeRef.current === code) return;

    const changes = findChanges(codeRef.current, code);
    codeRef.current = code;
    if (changes.length > 0) {
      view.dispatch({ changes });
    }
  }, [code]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(editable))
    });
  }, [editable, editableCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    let cancelled = false;
    const normalizedLang = lang.trim().toLowerCase();
    const language = languages.find((description) => {
      const aliases = description.alias ?? [];
      const extensions = description.extensions ?? [];
      return (
        description.name.toLowerCase() === normalizedLang ||
        aliases.includes(normalizedLang) ||
        extensions.includes(normalizedLang)
      );
    });

    if (!language) {
      view.dispatch({ effects: languageCompartment.reconfigure([]) });
      return;
    }

    language
      .load()
      .then((extension) => {
        if (cancelled || !viewRef.current) return;
        viewRef.current.dispatch({
          effects: languageCompartment.reconfigure(extension)
        });
      })
      .catch(() => {
        if (cancelled || !viewRef.current) return;
        viewRef.current.dispatch({ effects: languageCompartment.reconfigure([]) });
      });

    return () => {
      cancelled = true;
    };
  }, [lang, languageCompartment]);

  return <div ref={hostRef} className="openwebui-code-editor h-full w-full text-sm" />;
}

function MermaidPreview({ code, id }: { code: string; id: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const diagramId = `openwebui-mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict'
    });

    mermaid
      .render(diagramId, code)
      .then((result) => {
        if (cancelled) return;
        setSvg(DOMPurify.sanitize(result.svg));
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setSvg('');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (svg) {
    return (
      <div
        className="openwebui-mermaid-preview max-h-[32rem] overflow-auto rounded-2xl bg-white p-3"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  if (error) {
    return (
      <div className="border border-red-600/10 bg-red-600/10 px-4 py-3 text-sm text-red-800">
        Failed to render diagram: {error}
      </div>
    );
  }

  return <div className="px-4 py-3 text-xs text-gray-500">Rendering diagram...</div>;
}

export default function OpenWebUICodeBlock({
  id,
  code,
  lang = '',
  raw,
  collapsedDefault = false,
  editable = true,
  highlighted = false
}: OpenWebUICodeBlockProps) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  const [value, setValue] = useState(code);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const normalizedLang = lang.trim().toLowerCase();
  const displayLang = lang || 'Code';
  const closedFence = raw ? raw.trimEnd().endsWith('```') || raw.trimEnd().endsWith('~~~') : true;
  const canRenderMermaid = normalizedLang === 'mermaid' && closedFence;

  useEffect(() => {
    setValue(code);
  }, [code]);

  const saveCode = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1000);
  };

  const copyCode = async () => {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div>
      <div
        data-openwebui-code-block
        className={`openwebui-code-block not-prose relative my-0.5 flex flex-col rounded-2xl border border-gray-100/30 bg-white ${
          highlighted ? 'ring-1 ring-[#d3a900]/30' : ''
        }`}
        dir="ltr"
      >
        {canRenderMermaid ? (
          <MermaidPreview code={value} id={id} />
        ) : (
          <>
            <div className="flex w-full items-center justify-end gap-2 rounded-t-2xl bg-white px-3.5 py-1.5 text-xs text-black">
              <div className="flex-1 truncate">
                <span className="truncate text-ellipsis" title={displayLang}>
                  {displayLang}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setCollapsed((current) => !current)}
                  className="flex items-center gap-1 rounded-md border-none bg-white px-1.5 py-0.5 transition hover:bg-gray-50"
                >
                  <span className="-translate-y-[0.5px]">
                    <ChevronsUpDown className="size-3" />
                  </span>
                  <span>{collapsed ? 'Expand' : 'Collapse'}</span>
                </button>

                {editable ? (
                  <button
                    type="button"
                    onClick={saveCode}
                    className="rounded-md border-none bg-white px-1.5 py-0.5 transition hover:bg-gray-50"
                  >
                    {saved ? 'Saved' : 'Save'}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="flex items-center gap-1 rounded-md border-none bg-white px-1.5 py-0.5 transition hover:bg-gray-50"
                >
                  {copied ? <Check className="size-3" /> : null}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className={`language-${normalizedLang} overflow-hidden ${collapsed ? 'rounded-b-2xl' : ''}`}>
              {collapsed ? (
                <div className="flex flex-col gap-2 rounded-b-2xl bg-white px-4 pb-2 pt-1 text-xs">
                  <span className="italic text-gray-500">{value.split('\n').length} hidden lines</span>
                </div>
              ) : (
                <OpenWebUICodeEditor id={id} code={value} lang={normalizedLang} editable={editable} onChange={setValue} onSave={saveCode} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
