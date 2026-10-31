from vidmind import frames as fr


def test_a_frame_for_each_new_image_once_it_settles():
    assert fr.pick_times([20, 40], 60) == [1, 21, 41]
    assert fr.pick_times([2.96, 3.68, 5.12, 8.92], 12) == [1, 4.4, 6.12, 9.92]  # a state shown under MIN_SCENE_S is skipped


def test_too_few_scenes_falls_back_to_uniform_sampling():
    assert fr.pick_times([], 60) == [1, 10, 30, 50]
    assert fr.pick_times([], 8) == [1.33, 4, 6.67]  # short clips still get 3 looks
    assert fr.pick_times([18.2], 32.5) == [1, 5.42, 16.25, 19.2, 27.08]  # the one cut found is kept


def test_many_scenes_are_capped_and_tiny_scenes_skipped():
    times = fr.pick_times([i * 3 for i in range(1, 200)], 600)
    assert len(times) == fr.frame_cap(600) == 30 and times == sorted(times)
    assert fr.pick_times([10, 10.5, 30], 40) == [1, 11.5, 31]  # the 0.5 s sliver at 10 s is skipped
    assert fr.frame_cap(60) == fr.MIN_FRAMES and fr.frame_cap(7200) == fr.MAX_FRAMES


def test_the_biggest_changes_are_kept_not_every_nth():
    # 99 small flickers (a cursor, a hand) and 5 real slide changes in a 3-minute clip: cap 9 keeps all 5 slides.
    cuts = [(i * 1.8, 0.01) for i in range(1, 100)] + [(t + 0.9, 0.6) for t in (20, 50, 80, 110, 140)]
    times = fr.pick_times(cuts, 180)
    assert len(times) == fr.frame_cap(180) == 9 and times == sorted(times)
    assert all(any(0 < t - (c + 0.9) <= 2 for t in times) for c in (20, 50, 80, 110, 140))  # each slide, once settled


def test_the_same_picture_twice_is_kept_once(tmp_path):
    import subprocess

    clip = tmp_path / "still.mp4"  # one still picture for 6 s, then another
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=6", "-f", "lavfi", "-i",
                    "testsrc=s=320x180:d=6", "-filter_complex", "[0][1]concat=n=2:v=1", str(clip)], check=True)
    frames = fr.grab_frames(clip, [1.0, 4.0, 8.0], tmp_path / "frames")
    assert [f.t for f in frames] == [1.0, 8.0] and not (tmp_path / "frames" / "1.jpg").exists()


def test_fixture_frames_and_on_screen_only_text(fixture_clip, tmp_path):
    video, _ = fixture_clip
    frames = fr.sample_frames(video, 60, tmp_path / "frames")
    fr.read_text(frames, tmp_path)
    assert [f.t for f in frames] == [1, 21, 41]  # each slide, a second after it appears
    assert "40%" in frames[1].ocr_text  # never spoken in the clip
    assert not any(f.low_conf for f in frames)


def test_missing_ocr_engine_does_not_fail_the_job(fixture_clip, tmp_path, monkeypatch):
    # Windows/Linux without Tesseract installed: no Apple Vision, no tesseract binary.
    def no_vision(_):
        raise ImportError

    monkeypatch.setattr(fr, "_ocr_apple_vision", no_vision)
    monkeypatch.setattr(fr.pytesseract.pytesseract, "tesseract_cmd", "/nonexistent/tesseract")
    video, _ = fixture_clip
    fr.extract_frame(video, 30, tmp_path / "f.jpg")
    assert fr.ocr(tmp_path / "f.jpg") == ("", 0.0)
