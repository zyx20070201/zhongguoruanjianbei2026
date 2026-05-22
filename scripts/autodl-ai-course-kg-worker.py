import hashlib
import json
import os
import re
import sys
import time
import traceback
import types
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel


app = FastAPI(title="PP1 OneKE Course Knowledge Graph Worker")

API_KEY = os.environ.get("AI_COURSE_KG_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL = (
    os.environ.get("AI_COURSE_KG_MODEL")
    or os.environ.get("AI_LEARNING_MODEL")
    or os.environ.get("OPENAI_MODEL")
    or "gpt-5.4"
)
ONEKE_ROOT = Path(os.environ.get("ONEKE_ROOT", "/root/autodl-tmp/OneKE"))

RELATION_TYPES = {"prerequisite", "related", "part_of", "supports", "assesses", "remediates"}
ENTITY_TYPES = [
    "KnowledgeConcept",
    "Process",
    "FormalLanguageObject",
    "Notation",
    "TokenCategory",
    "AmbiguityCase",
    "Technique",
    "ProgrammingLanguage",
    "Example",
    "Formula",
    "Definition",
    "AssessmentPoint",
    "Misconception",
]
ONEKE_RELATION_TYPES = [
    "defines",
    "part_of",
    "requires",
    "uses",
    "describes",
    "contrasts_with",
    "causes_ambiguity",
    "resolved_by",
    "example_of",
    "maps_to",
    "assesses",
    "remediates",
]

RELATION_MAP = {
    "requires": "supports",
    "part_of": "part_of",
    "partof": "part_of",
    "assesses": "assesses",
    "remediates": "remediates",
    "resolved_by": "remediates",
    "resolvedby": "remediates",
    "uses": "supports",
    "defines": "supports",
    "describes": "supports",
    "example_of": "supports",
    "exampleof": "supports",
    "maps_to": "related",
    "mapsto": "related",
    "contrasts_with": "related",
    "contrastswith": "related",
    "causes_ambiguity": "related",
    "causesambiguity": "related",
}

GENERIC_NOISE_TITLES = {
    "课程内容",
    "开始",
    "结束",
    "目录",
    "本章内容",
    "主要内容",
    "学习目标",
    "教学目标",
    "小结",
    "总结",
    "例子",
    "示例",
    "问题",
    "作业",
    "练习",
    "参考",
    "计算机科学与技术学院",
    "老师",
    "教师",
    "学生",
    "slide",
    "slides",
    "chapter",
    "section",
    "course content",
    "content",
    "overview",
    "summary",
    "introduction",
}

KIND_MAP = {
    "Process": "procedure",
    "Technique": "skill",
    "TokenCategory": "concept",
    "FormalLanguageObject": "concept",
    "Notation": "concept",
    "ProgrammingLanguage": "application",
    "Example": "application",
    "Formula": "concept",
    "Definition": "concept",
    "AssessmentPoint": "assessment",
    "Misconception": "misconception",
    "AmbiguityCase": "misconception",
    "KnowledgeConcept": "concept",
}


class ExtractRequest(BaseModel):
    workspaceId: str
    fileObjectId: str
    source: Optional[str] = "ai_course_kg"
    resource: Dict[str, Any]
    semanticLayer: Dict[str, Any]
    chunks: List[Dict[str, Any]]
    existingCourseConcepts: List[Dict[str, Any]] = []


class OneKEProvider:
    def __init__(self) -> None:
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured on the OneKE KG worker")
        if not ONEKE_ROOT.exists():
            raise HTTPException(status_code=503, detail=f"OneKE is not installed at {ONEKE_ROOT}")
        src = str(ONEKE_ROOT / "src")
        if src not in sys.path:
            sys.path.insert(0, src)

        # OneKE's reference code sets local proxy variables at import time. The
        # AutoDL worker talks to configured API services directly, so clear them.
        # The quick API extraction path does not need the case-repository
        # embedder. Stub sentence_transformers before importing Pipeline so a
        # local torch/transformers mismatch cannot break API-only extraction.
        if "sentence_transformers" not in sys.modules:
            sentence_transformers_stub = types.ModuleType("sentence_transformers")

            class _UnusedSentenceTransformer:
                def __init__(self, *_args: Any, **_kwargs: Any) -> None:
                    pass

                def to(self, *_args: Any, **_kwargs: Any) -> "_UnusedSentenceTransformer":
                    return self

                def encode(self, *_args: Any, **_kwargs: Any) -> List[float]:
                    return []

                def similarity(self, *_args: Any, **_kwargs: Any) -> List[float]:
                    return []

            sentence_transformers_stub.SentenceTransformer = _UnusedSentenceTransformer
            sys.modules["sentence_transformers"] = sentence_transformers_stub

        from models import ChatGPT  # type: ignore
        from pipeline import Pipeline  # type: ignore
        import utils.process as oneke_process  # type: ignore

        for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
            os.environ.pop(key, None)

        def simple_sentence_tokenize(text: str) -> List[str]:
            lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
            return lines or [str(text or "")]

        # Avoid runtime dependency on external NLTK punkt data. Our inputs are
        # already chunked by the PP1 indexer, so line-based chunking is enough.
        oneke_process.sent_tokenize = simple_sentence_tokenize

        model = ChatGPT(model_name_or_path=MODEL, api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        model.set_hyperparameter(temperature=0.0, top_p=0.9, max_tokens=4096)
        self.model = model
        self.pipeline = Pipeline(model)

    def extract(self, text: str) -> Dict[str, Any]:
        entities, _, entity_schema, _ = self.pipeline.get_extract_result(
            task="NER",
            text=text,
            constraint=ENTITY_TYPES,
            mode="quick",
            update_case=False,
            show_trajectory=False,
        )
        relations, _, relation_schema, _ = self.pipeline.get_extract_result(
            task="RE",
            text=text,
            constraint=ONEKE_RELATION_TYPES,
            mode="quick",
            update_case=False,
            show_trajectory=False,
        )
        return fix_encoding_deep(
            {
                "entities": entities,
                "relations": relations,
                "entitySchema": entity_schema,
                "relationSchema": relation_schema,
            }
        )


_provider: Optional[OneKEProvider] = None


def provider() -> OneKEProvider:
    global _provider
    if _provider is None:
        _provider = OneKEProvider()
    return _provider


def authorize(authorization: Optional[str]) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def clip(value: Any, max_len: int = 900) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_len] + "..." if len(text) > max_len else text


def clamp01(value: Any, fallback: float = 0.5) -> float:
    try:
        number = float(value)
    except Exception:
        return fallback
    if number != number:
        return fallback
    return max(0.0, min(1.0, number))


def stable_id(prefix: str, value: Any, index: int = 0) -> str:
    digest = hashlib.sha1(json.dumps([value, index], ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:10]}"


def fix_mojibake(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    suspicious = any(ch in text for ch in ["Ã", "Â", "Ä", "Å", "Æ", "Ç", "È", "É", "Ê", "Ë", "Ì", "Í", "Î", "Ï", "Ð", "Ñ", "Ò", "Ó", "Ô", "Õ", "Ö", "Ù", "Ú", "Û", "Ü", "Ý", "Þ", "ß", "à", "á", "â", "ã", "ä", "å", "æ", "ç", "è", "é", "ê", "ë", "ì", "í", "î", "ï", "ð", "ñ", "ò", "ó", "ô", "õ", "ù", "ú", "û", "ü", "ý", "þ", "ÿ"])
    if not suspicious:
        return text
    try:
        fixed = text.encode("latin1").decode("utf-8")
        if count_cjk(fixed) > count_cjk(text) or "�" not in fixed:
            return fixed
    except Exception:
        return text
    return text


def fix_encoding_deep(value: Any) -> Any:
    if isinstance(value, str):
        return fix_mojibake(value)
    if isinstance(value, list):
        return [fix_encoding_deep(item) for item in value]
    if isinstance(value, dict):
        return {key: fix_encoding_deep(item) for key, item in value.items()}
    return value


def count_cjk(text: str) -> int:
    return sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")


def normalize_key(value: Any) -> str:
    text = fix_mojibake(str(value or "")).lower().strip()
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[（(].*?[）)]", "", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[\u3000\s`*_\"'“”‘’]+", "", text)
    return text


def unique(items: List[Any], max_items: int = 12) -> List[str]:
    seen = set()
    output: List[str] = []
    for item in items or []:
        text = clip(fix_mojibake(item), 160)
        key = normalize_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(text)
        if len(output) >= max_items:
            break
    return output


def normalized_chunks(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    output = []
    for chunk in chunks[:36]:
        raw_metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
        try:
            chunk_index = int(chunk.get("chunkIndex") or 0)
        except Exception:
            chunk_index = 0
        text = fix_mojibake(chunk.get("text") or "")
        summary = fix_mojibake(chunk.get("summary") or "")
        output.append(
            {
                "id": str(chunk.get("id") or f"chunk-{chunk_index}"),
                "chunkIndex": chunk_index,
                "summary": clip(summary, 300),
                "text": clip(text, 1800),
                "metadata": raw_metadata,
            }
        )
    return [chunk for chunk in output if chunk["text"] or chunk["summary"]]


def build_oneke_text(req: ExtractRequest, chunks: List[Dict[str, Any]]) -> str:
    parts = [
        f"Resource: {clip(req.resource.get('name'), 160)}",
        f"Path: {clip(req.resource.get('path'), 220)}",
        "Extract stable course knowledge-point entities and relations from the chunked evidence below.",
        "Keep technical terms precise. Prefer text-grounded concepts over broad topic labels.",
        "Do not extract exercise/question/query/task sentences, concrete assessment instances, resource/file names, examples, or prompt-like commands as entities.",
        "If a question or example mentions a concept, extract only the reusable concept or skill, not the full question/example text.",
        "Exercises will be extracted by the PP1 adapter as a side layer and must not become knowledge entities.",
    ]
    overview = clip(req.semanticLayer.get("overview") if isinstance(req.semanticLayer, dict) else "", 500)
    if overview:
        parts.append(f"Overview: {overview}")
    for chunk in chunks:
        heading_path = ""
        metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
        if isinstance(metadata.get("headingPath"), list) and metadata["headingPath"]:
            heading_path = " > ".join(clip(item, 80) for item in metadata["headingPath"][:6])
        header = f"### chunk {chunk['chunkIndex']}"
        if chunk.get("summary"):
            header += f": {chunk['summary']}"
        if heading_path:
            header += f"\nHeading: {heading_path}"
        parts.append(f"{header}\n{chunk['text']}")
    return "\n\n".join(parts)[:18000]


def entity_items(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    entities = raw.get("entities") or {}
    if isinstance(entities, dict):
        values = entities.get("entity_list") or entities.get("entities") or []
    else:
        values = entities if isinstance(entities, list) else []
    output = []
    for item in values:
        if not isinstance(item, dict):
            continue
        name = clip(item.get("name") or item.get("text") or item.get("entity"), 140)
        entity_type = clip(item.get("type") or item.get("entity_type") or "KnowledgeConcept", 80)
        if name and is_course_entity_candidate(name, entity_type):
            output.append({"name": name, "type": entity_type if entity_type in KIND_MAP else "KnowledgeConcept"})
    return dedupe_entities(output)


def relation_items(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    relations = raw.get("relations") or {}
    if isinstance(relations, dict):
        values = relations.get("relation_list") or relations.get("relations") or []
    else:
        values = relations if isinstance(relations, list) else []
    output = []
    for item in values:
        if not isinstance(item, dict):
            continue
        head = clip(item.get("head") or item.get("subject") or item.get("from"), 140)
        tail = clip(item.get("tail") or item.get("object") or item.get("to"), 180)
        relation = normalize_key(item.get("relation") or item.get("predicate") or item.get("type"))
        if head and tail and relation and head != tail:
            output.append({"head": head, "tail": tail, "relation": relation})
    return output[:120]


def is_course_entity_candidate(value: str, entity_type: str = "KnowledgeConcept") -> bool:
    text = clip(value, 160)
    if len(text) < 1 or len(text) > 80:
        return False
    if entity_type in {"Example", "AssessmentPoint", "Misconception", "AmbiguityCase"}:
        return False
    normalized = normalize_key(text)
    if normalized in {normalize_key(item) for item in GENERIC_NOISE_TITLES}:
        return False
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", text):
        upper = text.upper()
        if len(text) <= 1:
            return False
        if len(text) <= 2 and upper != text:
            return False
    if re.fullmatch(r"[A-Za-z][.)、]?", text):
        return False
    if re.search(r"[=<>+\-*/]{2,}", text):
        return False
    if entity_type == "Example" and len(text) <= 3:
        return False
    if re.search(r"https?://|www\.|^\d+$", text, re.I):
        return False
    if re.search(r"[。！？\n\r]", text) and len(text) > 24:
        return False
    compact = re.sub(r"\s+", "", text)
    if len(compact) > 12 and re.search(r"^(检索|查询|查找|找出|列出|统计|计算|求出?|判断|写出|设计|实现|完成|选择|说明|给出|证明|分析|比较|讨论|回答|简述|画出|创建|删除|插入|更新)", compact):
        return False
    if len(text) > 22 and re.search(r"^(find|list|query|retrieve|calculate|compute|write|design|implement|explain|choose|select|prove|discuss|compare|answer|create|delete|insert|update)\b", text, re.I):
        return False
    if len(text) > 10 and re.search(r"(学生学号|学生姓名|课程号|课程名|教师号|教师名|选修|所授课程|至少选修|平均成绩|最高成绩|最低成绩|查询.*数据|query\s+(practice|exercise|scenario|task)|practice|exercise|homework|assignment|question|scenario|task)", text, re.I):
        return False
    if re.search(r"(请|要求|需要|试|将|用).*(查询|检索|计算|写出|设计|实现|证明|说明|回答)", text) and len(text) > 12:
        return False
    if re.search(r"^(chunk|resource|path|overview|timestamps?|transcript evidence)$", text, re.I):
        return False
    if re.search(r"^(slide|page|chapter|section)\s*\d+$", text, re.I):
        return False
    if re.search(r"^(multiple|duplication|efficient|data|query|authorization|conceptual|cartesian|scalar|null)\s+\w+.*\.\.\.$", text, re.I):
        return False
    return True


def dedupe_entities(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for item in items:
        key = normalize_key(item["name"])
        if not key:
            continue
        existing = by_key.get(key)
        if not existing or len(item["name"]) < len(existing["name"]):
            by_key[key] = item
    return list(by_key.values())[:80]


def expand_parenthetical_aliases(name: str) -> List[str]:
    text = clip(name, 140)
    match = re.fullmatch(r"(.+?)[（(]([^（）()]{1,60})[）)]", text)
    if not match:
        return [text]
    primary = clip(match.group(1), 100)
    alias = clip(match.group(2), 100)
    return unique([primary, alias, text], 3)


def find_alias_pairs(entities: List[Dict[str, Any]], chunks: List[Dict[str, Any]]) -> Dict[str, str]:
    keys = {normalize_key(item["name"]): item["name"] for item in entities}
    aliases: Dict[str, str] = {}
    pair_pattern = re.compile(r"([\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_\-\s]{0,24})[（(]([A-Za-z][A-Za-z0-9_\-\s/+]{1,40})[）)]")
    for chunk in chunks:
        text = f"{chunk.get('summary') or ''}\n{chunk.get('text') or ''}"
        for match in pair_pattern.finditer(text):
            zh = clip(match.group(1), 80)
            en = clip(match.group(2), 80)
            zh_key = normalize_key(zh)
            en_key = normalize_key(en)
            if zh_key in keys and en_key in keys:
                aliases[en_key] = zh_key
    return aliases


def chunk_contains(chunk: Dict[str, Any], term: str) -> bool:
    if not term:
        return False
    text = normalize_key(f"{chunk.get('summary') or ''}\n{chunk.get('text') or ''}")
    key = normalize_key(term)
    return bool(key and key in text)


def quote_for(chunk: Dict[str, Any], terms: List[str], max_len: int = 260) -> str:
    text = re.sub(r"\s+", " ", f"{chunk.get('summary') or ''} {chunk.get('text') or ''}").strip()
    if not text:
        return ""
    lowered = normalize_key(text)
    positions = []
    for term in terms:
        key = normalize_key(term)
        pos = lowered.find(key) if key else -1
        if pos >= 0:
            positions.append(pos)
    if not positions:
        return clip(text, max_len)
    pos = max(0, min(positions) - 70)
    return clip(text[pos : pos + max_len], max_len)


def evidence_refs_for(
    terms: List[str],
    chunks: List[Dict[str, Any]],
    limit: int = 4,
    allow_fallback: bool = False,
) -> List[Dict[str, Any]]:
    refs = []
    seen = set()
    normalized_terms = [term for term in terms if normalize_key(term)]
    for chunk in chunks:
        if not any(chunk_contains(chunk, term) for term in normalized_terms):
            continue
        key = chunk["id"]
        if key in seen:
            continue
        seen.add(key)
        refs.append(
            {
                "chunkId": chunk["id"],
                "chunkIndex": chunk["chunkIndex"],
                "quote": quote_for(chunk, normalized_terms),
                "rationale": "OneKE mention grounded in this chunk.",
            }
        )
        if len(refs) >= limit:
            break
    if refs or not allow_fallback:
        return refs
    fallback = chunks[0] if chunks else None
    if not fallback:
        return []
    return [
        {
            "chunkId": fallback["id"],
            "chunkIndex": fallback["chunkIndex"],
            "quote": quote_for(fallback, normalized_terms),
            "rationale": "Fallback chunk evidence for OneKE extraction.",
        }
    ]


def relation_evidence_refs_for(head_terms: List[str], tail_terms: List[str], chunks: List[Dict[str, Any]], limit: int = 3) -> List[Dict[str, Any]]:
    refs = []
    seen = set()
    heads = [term for term in head_terms if normalize_key(term)]
    tails = [term for term in tail_terms if normalize_key(term)]
    for chunk in chunks:
        has_head = any(chunk_contains(chunk, term) for term in heads)
        has_tail = any(chunk_contains(chunk, term) for term in tails)
        if not (has_head and has_tail):
            continue
        key = chunk["id"]
        if key in seen:
            continue
        seen.add(key)
        refs.append(
            {
                "chunkId": chunk["id"],
                "chunkIndex": chunk["chunkIndex"],
                "quote": quote_for(chunk, [*heads, *tails]),
                "rationale": "OneKE relation endpoints co-occur in this chunk.",
            }
        )
        if len(refs) >= limit:
            break
    return refs


EXERCISE_START_RE = re.compile(
    r"^\s*(?:"
    r"(?:例|习题|练习|任务|问题|题目|思考题|课后题|作业|案例)\s*\d*[\.:：、)]?\s*"
    r"|(?:\d{1,2}|[一二三四五六七八九十]+)[\.、)]\s*"
    r"|(?:query|practice|exercise|homework|assignment|question|task|case)\b[:：]?\s*"
    r")",
    re.I,
)


def exercise_type_for(text: str) -> str:
    compact = re.sub(r"\s+", "", text)
    if re.search(r"SQL|代码|编程|程序|实现|coding|code|implement", text, re.I):
        return "coding"
    if re.search(r"设计|建模|方案|schema|design", text, re.I):
        return "design"
    if re.search(r"计算|求|统计|平均|最大|最小|calculate|compute", text, re.I):
        return "calculation"
    if re.search(r"解释|说明|简述|分析|比较|explain|describe|compare", text, re.I):
        return "explanation"
    if re.search(r"完成|任务|task|assignment", compact, re.I):
        return "task"
    if re.search(r"选择|判断|填空|quiz|single choice|multiple choice|true.?false", text, re.I):
        return "quiz"
    return "question"


def candidate_exercise_prompts(chunks: List[Dict[str, Any]], max_items: int = 36) -> List[Dict[str, Any]]:
    prompts: List[Dict[str, Any]] = []
    seen = set()
    for chunk in chunks:
        text = fix_mojibake(chunk.get("text") or "")
        lines = [line.strip() for line in re.split(r"[\n\r]+", text) if line.strip()]
        candidates: List[str] = []
        for line in lines:
            if EXERCISE_START_RE.search(line) or re.search(r"[?？]$", line):
                candidates.append(line)
        if not candidates:
            for sentence in re.split(r"(?<=[。！？?])\s+", text):
                sentence = sentence.strip()
                if EXERCISE_START_RE.search(sentence) or re.search(r"[?？]$", sentence):
                    candidates.append(sentence)
        for prompt in candidates:
            prompt = clip(prompt, 900)
            compact = re.sub(r"\s+", "", prompt)
            if len(compact) < 12 or len(compact) > 700:
                continue
            if re.search(r"^(resource|path|overview|chunk|heading)\b", prompt, re.I):
                continue
            key = normalize_key(compact)
            if key in seen:
                continue
            seen.add(key)
            prompts.append(
                {
                    "prompt": prompt,
                    "chunkId": chunk.get("id"),
                    "chunkIndex": chunk.get("chunkIndex"),
                    "summary": chunk.get("summary") or "",
                }
            )
            if len(prompts) >= max_items:
                return prompts
    return prompts


def build_exercises(concepts: List[Dict[str, Any]], chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    concept_terms = []
    for concept in concepts:
        terms = [concept.get("title") or "", *(concept.get("aliases") or [])]
        concept_terms.append((concept, [term for term in terms if term]))
    exercises = []
    for index, item in enumerate(candidate_exercise_prompts(chunks)):
        prompt = item["prompt"]
        matched = []
        prompt_key = normalize_key(prompt)
        for concept, terms in concept_terms:
            for term in terms:
                term_key = normalize_key(term)
                if term_key and (term_key in prompt_key or str(term) in prompt):
                    matched.append(concept)
                    break
            if len(matched) >= 5:
                break
        if not matched:
            continue
        title = re.sub(r"^\s*(?:例|习题|练习|任务|问题|题目|思考题|课后题|作业|案例)?\s*\d*[\.:：、)]?\s*", "", prompt)
        title = clip(title, 120) or f"练习 {index + 1}"
        exercises.append(
            {
                "localId": stable_id("e", [prompt, item.get("chunkId")], index),
                "title": title,
                "prompt": prompt,
                "exerciseType": exercise_type_for(prompt),
                "difficulty": 0.58 if len(prompt) > 180 else 0.46,
                "answer": None,
                "explanation": "",
                "conceptLocalIds": unique([concept["localId"] for concept in matched], 6),
                "conceptTitles": unique([concept["title"] for concept in matched], 6),
                "confidence": 0.72,
                "evidenceRefs": [
                    {
                        "chunkId": item.get("chunkId"),
                        "chunkIndex": item.get("chunkIndex"),
                        "quote": clip(prompt, 360),
                        "rationale": "Exercise prompt mentions one or more approved course concepts.",
                    }
                ],
                "approved": True,
                "reviewConfidence": 0.72,
                "reviewIssues": [],
            }
        )
        if len(exercises) >= 24:
            break
    return exercises


def existing_match(title: str, aliases: List[str], existing: List[Dict[str, Any]]) -> Optional[str]:
    candidate_keys = {normalize_key(title), *(normalize_key(alias) for alias in aliases)}
    candidate_keys.discard("")
    for item in existing:
        keys = {normalize_key(item.get("title"))}
        raw_aliases = item.get("aliases") if isinstance(item.get("aliases"), list) else []
        keys.update(normalize_key(alias) for alias in raw_aliases)
        keys.discard("")
        if candidate_keys & keys:
            return str(item.get("id"))
    return None


def concept_difficulty(entity_type: str) -> float:
    if entity_type in {"Formula", "Notation", "FormalLanguageObject"}:
        return 0.6
    if entity_type in {"Process", "Technique"}:
        return 0.55
    if entity_type in {"Example", "ProgrammingLanguage"}:
        return 0.42
    return 0.5


def description_for(name: str, aliases: List[str], relations: List[Dict[str, str]], entity_names: set) -> str:
    parts = []
    keys = {normalize_key(name), *(normalize_key(alias) for alias in aliases)}
    for relation in relations:
        if normalize_key(relation["head"]) not in keys:
            continue
        tail_key = normalize_key(relation["tail"])
        if tail_key in entity_names:
            continue
        if relation["relation"] in {"defines", "describes", "maps_to"}:
            parts.append(f"{relation['relation']}: {relation['tail']}")
    return clip("；".join(unique(parts, 3)), 420)


def adapt_oneke_output(req: ExtractRequest, chunks: List[Dict[str, Any]], raw: Dict[str, Any]) -> Dict[str, Any]:
    entities = entity_items(raw)
    relations = relation_items(raw)
    alias_parent = find_alias_pairs(entities, chunks)

    groups: Dict[str, Dict[str, Any]] = {}
    for entity in entities:
        key = normalize_key(entity["name"])
        parent_key = alias_parent.get(key, key)
        group = groups.setdefault(parent_key, {"names": [], "types": []})
        group["names"].extend(expand_parenthetical_aliases(entity["name"]))
        group["types"].append(entity["type"])

    # Add missing relation heads only. Tails that OneKE did not recognize as
    # entities are usually definitions, examples, or attributes, and should not
    # become graph nodes by default.
    for relation in relations:
        name = relation["head"]
        key = normalize_key(name)
        if key not in groups and is_course_entity_candidate(name):
            groups[key] = {"names": expand_parenthetical_aliases(name), "types": ["KnowledgeConcept"]}

    concept_by_key: Dict[str, Dict[str, Any]] = {}
    entity_names = set(groups.keys())
    concepts = []
    for index, (key, group) in enumerate(groups.items()):
        names = unique(group["names"], 10)
        title = choose_canonical_title(names)
        aliases = unique([name for name in names if name != title], 10)
        entity_type = choose_entity_type(group["types"])
        evidence = evidence_refs_for([title, *aliases], chunks)
        local_id = stable_id("c", key, index)
        existing_id = existing_match(title, aliases, req.existingCourseConcepts)
        concept = {
            "localId": local_id,
            "title": title,
            "description": description_for(title, aliases, relations, entity_names),
            "aliases": aliases,
            "kind": KIND_MAP.get(entity_type, "concept"),
            "difficulty": concept_difficulty(entity_type),
            "confidence": 0.82 if evidence else 0.62,
            "evidenceRefs": evidence,
            "action": "existing" if existing_id else "new",
            "existingConceptId": existing_id,
            "canonicalTitle": title,
            "canonicalAliases": unique([title, *aliases], 12),
            "canonicalRationale": "Deterministic OneKE canonicalization by normalized mention and alias pairing.",
            "approved": bool(evidence),
            "reviewConfidence": 0.82 if evidence else 0.55,
            "reviewIssues": [] if evidence else ["no_exact_mention_evidence"],
            "onekeEntityType": entity_type,
        }
        concepts.append(concept)
        for name in names:
            concept_by_key[normalize_key(name)] = concept
        concept_by_key[key] = concept

    adapted_relations = []
    seen_edges = set()
    for index, relation in enumerate(relations):
        from_concept = concept_by_key.get(normalize_key(relation["head"]))
        to_concept = concept_by_key.get(normalize_key(relation["tail"]))
        if not from_concept or not to_concept or from_concept["localId"] == to_concept["localId"]:
            continue
        relation_type = RELATION_MAP.get(relation["relation"], "related")
        if relation_type not in RELATION_TYPES:
            relation_type = "related"
        edge_key = (from_concept["localId"], to_concept["localId"], relation_type)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        evidence = relation_evidence_refs_for(
            [relation["head"], from_concept["title"], *from_concept.get("aliases", [])],
            [relation["tail"], to_concept["title"], *to_concept.get("aliases", [])],
            chunks,
            3,
        )
        adapted_relations.append(
            {
                "localId": stable_id("r", [relation["head"], relation["tail"], relation["relation"]], index),
                "fromLocalId": from_concept["localId"],
                "toLocalId": to_concept["localId"],
                "relationType": relation_type,
                "description": clip(f"OneKE relation `{relation['relation']}`: {relation['head']} -> {relation['tail']}", 360),
                "weight": 0.72 if relation_type != "related" else 0.58,
                "confidence": 0.78 if evidence else 0.55,
                "evidenceRefs": evidence,
                "approved": bool(evidence),
                "reviewConfidence": 0.78 if evidence else 0.55,
                "reviewIssues": [] if evidence else ["no_relation_evidence"],
                "onekeRelationType": relation["relation"],
            }
        )

    misconceptions = [
        {
            "localId": stable_id("m", concept["title"], index),
            "conceptLocalId": concept["localId"],
            "title": f"{concept['title']} 相关误解",
            "description": concept["description"] or f"OneKE identified {concept['title']} as an ambiguity or misconception-related item.",
            "repairHint": "回到证据片段，区分定义、例子与适用条件。",
            "severity": 0.55,
            "confidence": 0.62,
            "evidenceRefs": concept["evidenceRefs"],
            "approved": True,
            "reviewConfidence": 0.62,
            "reviewIssues": [],
        }
        for index, concept in enumerate(concepts)
        if concept.get("onekeEntityType") in {"Misconception", "AmbiguityCase"}
    ][:12]

    exercises = build_exercises([concept for concept in concepts if concept.get("approved")], chunks)
    communities = build_communities(concepts, adapted_relations, chunks)
    return {
        "concepts": concepts,
        "relations": adapted_relations,
        "exercises": exercises,
        "misconceptions": misconceptions,
        "communities": communities,
        "rawEntityCount": len(entities),
        "rawRelationCount": len(relations),
    }


def choose_canonical_title(names: List[str]) -> str:
    cjk_names = [name for name in names if count_cjk(name)]
    if cjk_names:
        return sorted(cjk_names, key=lambda item: (len(item), item))[0]
    return sorted(names, key=lambda item: (len(item), item.lower()))[0]


def choose_entity_type(types: List[str]) -> str:
    priority = [
        "Misconception",
        "AmbiguityCase",
        "AssessmentPoint",
        "Process",
        "Technique",
        "FormalLanguageObject",
        "TokenCategory",
        "Notation",
        "Formula",
        "Definition",
        "ProgrammingLanguage",
        "Example",
        "KnowledgeConcept",
    ]
    for item in priority:
        if item in types:
            return item
    return types[0] if types else "KnowledgeConcept"


def build_communities(concepts: List[Dict[str, Any]], relations: List[Dict[str, Any]], chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not concepts:
        return []
    concept_ids = [concept["localId"] for concept in concepts[:24]]
    return [
        {
            "id": "oneke-community-main",
            "title": "OneKE extracted course knowledge",
            "summary": "基于 OneKE schema-driven IE 抽取出的主要课程知识对象与关系。",
            "conceptLocalIds": concept_ids,
            "relationLocalIds": [relation["localId"] for relation in relations[:40]],
            "learningSequence": concept_ids[:12],
            "evidenceRefs": evidence_refs_for([concept["title"] for concept in concepts[:6]], chunks, 4, allow_fallback=True),
            "confidence": 0.78,
        }
    ]


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "ai-course-kg-oneke",
        "provider": "oneke",
        "onekeRoot": str(ONEKE_ROOT),
        "onekeInstalled": ONEKE_ROOT.exists(),
        "model": MODEL,
        "baseUrl": OPENAI_BASE_URL,
        "configured": bool(OPENAI_API_KEY),
    }


@app.post("/extract")
def extract(req: ExtractRequest, authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    authorize(authorization)
    started = time.time()
    chunks = normalized_chunks(req.chunks)
    if not chunks:
        raise HTTPException(status_code=422, detail="No chunks were supplied")
    try:
        raw = provider().extract(build_oneke_text(req, chunks))
        adapted = adapt_oneke_output(req, chunks, raw)
    except HTTPException:
        raise
    except Exception as exc:
        print(traceback.format_exc(), flush=True)
        raise HTTPException(status_code=502, detail=str(exc))

    concepts = adapted["concepts"]
    relations = adapted["relations"]
    exercises = adapted["exercises"]
    misconceptions = adapted["misconceptions"]
    return {
        "schema": "ai_course_knowledge_graph_extraction.v1",
        "workspaceId": req.workspaceId,
        "fileObjectId": req.fileObjectId,
        "source": req.source or "ai_course_kg",
        "models": {
            "extraction": f"OneKE/{MODEL}",
            "canonicalization": "pp1-oneke-adapter.v1",
            "review": "pp1-evidence-adapter.v1",
            "communities": "pp1-oneke-adapter.v1",
        },
        "concepts": concepts,
        "relations": relations,
        "exercises": exercises,
        "misconceptions": misconceptions,
        "communities": adapted["communities"],
        "trace": {
            "rawEntityCount": adapted["rawEntityCount"],
            "rawRelationCount": adapted["rawRelationCount"],
            "extractedConceptCount": len(concepts),
            "extractedRelationCount": len(relations),
            "extractedExerciseCount": len(exercises),
            "extractedMisconceptionCount": len(misconceptions),
            "approvedConceptCount": len([item for item in concepts if item.get("approved")]),
            "approvedRelationCount": len([item for item in relations if item.get("approved")]),
            "approvedExerciseCount": len([item for item in exercises if item.get("approved")]),
            "approvedMisconceptionCount": len([item for item in misconceptions if item.get("approved")]),
            "latencyMs": int((time.time() - started) * 1000),
        },
    }
