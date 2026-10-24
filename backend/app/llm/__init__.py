"""Optional drafting help: case summaries and letters.

Uses Groq (free tier) when GROQ_API_KEY is set, and always falls back to the offline templates
below. Every draft is labelled for human review. Nothing here ever recommends or makes a decision.
"""

from __future__ import annotations

import logging

from app.config import get_settings

log = logging.getLogger("argus.llm")

DRAFT_LABEL = "Draft, to be reviewed by the officer"

_SYSTEM = (
    "You draft neutral administrative text for officers of a technical-education regulator. "
    "Use only the facts given. Do not invent facts. Never recommend, approve, reject, grant or deny anything; "
    "decisions are taken by the competent human authority. Plain English, short paragraphs and '-' bullet points. "
    "Plain text only: no Markdown, no bold, no headings with # or *."
)


def llm_available() -> bool:
    return bool(get_settings().groq_api_key)


def _complete(prompt: str, max_tokens: int = 1500) -> str | None:
    s = get_settings()
    if not s.groq_api_key:
        return None
    try:
        from groq import BadRequestError, Groq

        client = Groq(api_key=s.groq_api_key, timeout=15.0, max_retries=0)
        args = {
            "model": s.llm_model,
            "messages": [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        try:
            # reasoning models (for example openai/gpt-oss-*) otherwise spend the budget thinking
            resp = client.chat.completions.create(**args, reasoning_effort="low")
        except BadRequestError:
            resp = client.chat.completions.create(**args)  # model without a reasoning setting
        choice = resp.choices[0]
        text = (choice.message.content or "").strip()
        if not text:
            log.warning("LLM returned no text (finish reason %s), using template", choice.finish_reason)
        return text or None
    except Exception as exc:  # network, quota, unknown model: fall back to the template
        log.warning("LLM draft failed, using template: %s", type(exc).__name__)
        return None


# ------------------------------------------------------------------ case summary
def template_summary(f: dict) -> str:
    lines = [
        f"Application {f['ref_no']}: {f['type_name']} ({f['programme']}), academic year {f['academic_year']}.",
        f"Institution: {f['institution']}, {f['city']} ({f['region']} Region). Route: {f['route_name']}.",
        f"Submitted on {f['submitted']}. {f['elapsed_days']} days in process: "
        f"{f['institution_days']} waiting on the institution, {f['aicte_days']} with AICTE officers and committees.",
        "",
        "Stage history:",
    ]
    for s in f["stages"]:
        lines.append(f"- {s['name']}: {s['status_text']}")
    lines.append("")
    if f["deficiencies"]:
        lines.append(f"Deficiencies raised: {len(f['deficiencies'])}.")
        for i, d in enumerate(f["deficiencies"], 1):
            reply = f"replied on {d['responded']}" if d["responded"] else "reply pending"
            lines.append(f"  {i}. {d['reason']} ({reply})")
    else:
        lines.append("Deficiencies raised: none.")
    if f.get("evc"):
        e = f["evc"]
        lines.append(f"Expert visit: {e['status_text']}.")
        if e.get("findings"):
            lines.append(f"  Visit report ({e['recommendation_text']}): {e['findings']}")
    c = f["compliance"]
    lines.append(
        f"Compliance record of the institution: {c['open_undertakings']} open undertaking(s), "
        f"{c['overdue_undertakings']} overdue; {c['expired_documents']} expired and "
        f"{c['expiring_documents']} soon-to-expire tracked document(s)."
    )
    if f["points"]:
        lines.append("")
        lines.append("Points the committee may wish to note:")
        lines += [f"- {p}" for p in f["points"]]
    lines.append("")
    lines.append("This summary is compiled from case records. It does not recommend an outcome.")
    return "\n".join(lines)


SUMMARY_CLOSING = "This summary is compiled from case records. It does not recommend an outcome."


def case_summary(facts: dict, use_llm: bool = False) -> tuple[str, str]:
    """Returns (text, source) where source is 'llm' or 'template'."""
    base = template_summary(facts)
    if use_llm:
        prompt = (
            "Rewrite these case facts as a concise case summary for an SAC/SHC committee (max 220 words). "
            "Keep every number and date exactly. End with the sentence "
            "'This summary is compiled from case records. It does not recommend an outcome.'\n\n" + base
        )
        text = _complete(prompt)
        if text:
            # the model is asked to keep this sentence; make sure of it rather than trust it
            if SUMMARY_CLOSING not in text:
                text = f"{text.rstrip()}\n\n{SUMMARY_CLOSING}"
            return text, "llm"
    return base, "template"


def reword(sentence: str) -> tuple[str, str]:
    """Reword a risk summary in plain language with the AI helper; the template sentence otherwise.
    Returns (text, source). Dates, numbers and the case reference must survive unchanged."""
    text = _complete("Reword this sentence for a busy government officer, in one or two plain sentences. Keep every "
                     "date, number and reference exactly as written. Do not add advice.\n\n" + sentence, max_tokens=200)
    if text and len(text) < 600:
        return text.strip(), "llm"
    return sentence, "template"


# ------------------------------------------------------------------ letters
LETTER_LABEL = "SYNTHETIC DATA - prototype draft, not an official AICTE letter"


def template_letter(kind: str, f: dict) -> str:
    head = [
        LETTER_LABEL,
        "",
        f"To: The Principal / Director, {f['institution']}, {f['city']}",
        f"Subject: {'Deficiency in' if kind == 'deficiency' else 'Reminder regarding'} application {f['ref_no']}",
        "",
        "Sir / Madam,",
        "",
    ]
    if kind == "deficiency":
        body = [
            f"With reference to your application {f['ref_no']} ({f['type_name']}), the following deficiency was noted "
            "during scrutiny:",
            "",
            f"    {f.get('reason') or '[officer to describe the deficiency]'}",
            "",
            f"You are requested to submit your reply with supporting documents on the portal by {f.get('due') or '[date]'}. "
            "The processing time limit for AICTE stays paused until your reply is received.",
        ]
    else:
        body = [
            f"This is a reminder that the following item for {f['institution']} is due on {f.get('due') or '[date]'}:",
            "",
            f"    {f.get('item') or '[item]'}",
            "",
            "Please upload the required evidence on the portal before the due date to avoid escalation.",
        ]
    return "\n".join(head + body + ["", "Yours faithfully,", "[Officer name and designation]"])


def draft_letter(kind: str, facts: dict, use_llm: bool = False) -> tuple[str, str]:
    base = template_letter(kind, facts)
    if use_llm:
        text = _complete(
            "Improve the wording of this formal letter draft. Keep it short and polite, keep all facts, dates and "
            "the first line unchanged, and do not add any decision.\n\n" + base,
        )
        if text:
            # the label must head every draft, whatever the model returns
            body = "\n".join(line for line in text.splitlines() if "SYNTHETIC DATA" not in line).strip()
            return f"{LETTER_LABEL}\n\n{body}", "llm"
    return base, "template"
