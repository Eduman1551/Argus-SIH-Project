from app import clock, llm
from app.workflow.facts import case_facts


def test_drafts_fall_back_to_templates_without_a_key(conn, monkeypatch):
    monkeypatch.setattr(llm, "_complete", lambda *a, **k: None)  # as if Groq is absent or failing
    app_id = conn.val("SELECT id FROM applications WHERE demo_tag = 'demo_sac'")
    facts = case_facts(conn, app_id, clock.now(conn))
    text, source = llm.case_summary(facts, use_llm=True)
    assert source == "template"
    assert facts["ref_no"] in text and "does not recommend an outcome" in text
    for word in ("approve", "reject", "grant", "deny"):
        assert f" {word} " not in f" {text.lower()} "
    letter, source = llm.draft_letter("deficiency", {**facts, "reason": "Upload the lease deed.", "due": None}, use_llm=True)
    assert source == "template" and "SYNTHETIC DATA" in letter and "Upload the lease deed." in letter


def test_model_drafts_always_keep_label_and_closing(conn, monkeypatch):
    # a model that drops the required first line and closing sentence
    monkeypatch.setattr(llm, "_complete", lambda *a, **k: "Dear Principal, please upload the lease deed.")
    app_id = conn.val("SELECT id FROM applications WHERE demo_tag = 'demo_sac'")
    facts = case_facts(conn, app_id, clock.now(conn))
    text, source = llm.case_summary(facts, use_llm=True)
    assert source == "llm" and text.endswith(llm.SUMMARY_CLOSING)
    letter, source = llm.draft_letter("deficiency", {**facts, "reason": "x", "due": None}, use_llm=True)
    assert source == "llm" and letter.splitlines()[0] == llm.LETTER_LABEL
