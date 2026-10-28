from vidmind.schema import Frame, LearnOutput, Segment, ground

SEGMENTS = [
    Segment(3.9, 8.2, "We define activation as the moment a user creates their first project."),
    Segment(22.7, 26.5, "Retention tells us how many users come back after their first week."),
]
FRAMES = [Frame(10.0, "frames/0.jpg", "Activation = first project created", 95),
          Frame(30.0, "frames/1.jpg", "Week-1 retention target: 40%", 96)]


def output(notes, quiz_t=4.0, chapter_t=0.0):
    return LearnOutput.model_validate({
        "title": "T",
        "chapters": [{"title": "C", "start_seconds": chapter_t, "notes": notes}],
        "quiz": [{"question": "Q", "answer": "A", "evidence_start_seconds": quiz_t}],
    })


def note(*evidence, text="N"):
    return {"text": text, "evidence": list(evidence)}


def tr(t, quote):
    return {"kind": "transcript", "start_seconds": t, "quote": quote}


def fr(t, text="x"):
    return {"kind": "frame", "start_seconds": t, "text": text}


def test_valid_output_passes_and_frames_get_server_urls():
    out, problems, dropped = ground(
        output([note(tr(4, "a user creates their first project"), fr(10.5))]), SEGMENTS, FRAMES, 60
    )
    assert problems == [] and dropped == []
    frame_ev = out.chapters[0].notes[0].evidence[1]
    assert frame_ev.frame_url == "frames/0.jpg" and frame_ev.start_seconds == 10.0


def test_quote_match_tolerates_small_asr_differences():
    _, problems, _ = ground(output([note(tr(23, "how many user come back after the first week"))]), SEGMENTS, FRAMES, 60)
    assert problems == []


def test_fabricated_quote_is_dropped():
    out, problems, dropped = ground(output([note(tr(4, "activation means paying for a plan"))]), SEGMENTS, FRAMES, 60)
    assert len(dropped) == 1 and out.chapters == [] and "not in the transcript" in problems[0]
    assert dropped[0].text == "N" and "not in the transcript" in dropped[0].reasons[0]  # shown in the UI


def test_quote_at_wrong_time_is_dropped():
    _, problems, dropped = ground(output([note(tr(50, "a user creates their first project"))]), SEGMENTS, FRAMES, 60)
    assert len(dropped) == 1 and problems


def test_note_without_evidence_is_dropped():
    _, problems, dropped = ground(output([note()]), SEGMENTS, FRAMES, 60)
    assert len(dropped) == 1 and "no evidence" in problems[0]


def test_unsampled_frame_and_out_of_range_timestamps_are_rejected():
    out, problems, dropped = ground(output([note(fr(20)), note(fr(95))], quiz_t=120), SEGMENTS, FRAMES, 60)
    assert len(dropped) == 2 and out.quiz == []
    assert any("no sampled frame" in p for p in problems)
    assert any("outside the video" in p for p in problems)


def test_bad_evidence_is_removed_but_supported_note_survives():
    out, _, dropped = ground(output([note(tr(4, "made-up words here"), fr(30))]), SEGMENTS, FRAMES, 60)
    assert dropped == [] and [e.kind for e in out.chapters[0].notes[0].evidence] == ["frame"]


def test_frame_only_note_from_unreadable_frame_is_marked_uncertain():
    frames = [Frame(30.0, "frames/1.jpg", "W3ek-l ret3nt", 55, low_conf=True)]
    out, _, _ = ground(output([note(fr(30))]), SEGMENTS, frames, 60)
    n = out.chapters[0].notes[0]
    assert n.uncertain and n.uncertain_reason


def test_duplicate_frame_citations_are_collapsed():
    out, _, _ = ground(output([note(fr(10), fr(10.4), tr(4, "a user creates their first project"))]), SEGMENTS, FRAMES, 60)
    assert [e.kind for e in out.chapters[0].notes[0].evidence] == ["frame", "transcript"]


def test_malformed_notes_and_quiz_items_are_dropped_not_fatal():
    from vidmind.schema import SectionOutput

    out = SectionOutput.model_validate({
        "title": "T",
        "notes": [note(tr(4, "their first project")), "just a string", {"text": "no evidence key"}],
        "quiz": [{"question": "Q?", "answer": "A", "evidence_start_seconds": 4}, {"question": "no answer"}],
    })
    assert len(out.notes) == 1 and len(out.quiz) == 1


def test_heard_quotes_snap_to_the_transcripts_exact_words():
    from vidmind.schema import Segment, snap_quote

    segs = [Segment(20.0, 26.0, "Microservices let each team deploy its own service independently.")]
    assert snap_quote("micro services let every team deploy their own service", 21.0, segs) == \
        ("Microservices let each team deploy its own service independently", 20.0)  # its exact words
    assert snap_quote("kafka partitions are replicated", 21.0, segs) is None  # nothing close: left for the check
    assert snap_quote("let each team deploy", 60.0, segs) is None  # too far from when it was said
