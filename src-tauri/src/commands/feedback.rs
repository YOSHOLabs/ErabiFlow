use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const MAX_FEEDBACK_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BATCH_EVENTS: usize = 10_000;
const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;
const CURRENT_FILE: &str = "events-v1.jsonl";
const PREVIOUS_FILE: &str = "events-v1.previous.jsonl";
const LOCK_FILE: &str = "events-v1.lock";

static FEEDBACK_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum HighlightFeedbackAction {
    Shown,
    Previewed,
    Adopted,
    Unadopted,
    Queued,
    Dequeued,
    Trimmed,
    Rejected,
    Restored,
    Missed,
    Exported,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum MissedHighlightCategory {
    Victory,
    Failure,
    Surprise,
    Comedy,
    Explanation,
    Other,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HighlightFeedbackRange {
    start: f64,
    end: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HighlightFeedbackScores {
    event: f64,
    reaction: f64,
    clipability: f64,
    confidence: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HighlightFeedbackEvent {
    schema_version: u8,
    event_id: String,
    occurred_at: String,
    action: HighlightFeedbackAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    analysis_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    candidate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    clip_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    candidate_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    analysis_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    initial_range: Option<HighlightFeedbackRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    current_range: Option<HighlightFeedbackRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    score_details: Option<HighlightFeedbackScores>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<MissedHighlightCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    nearest_candidate_iou: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightFeedbackStatus {
    bytes: u64,
    previous_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightFeedbackBoundarySummary {
    sample_count: u64,
    mean_start_delta_seconds: f64,
    mean_end_delta_seconds: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightFeedbackSummary {
    schema_version: u8,
    valid_event_count: u64,
    invalid_line_count: u64,
    shown_candidates: u64,
    adopted_candidates: u64,
    rejected_candidates: u64,
    exported_candidates: u64,
    missed_ranges: u64,
    uncovered_missed_ranges: u64,
    accepted_per_shown: Option<f64>,
    rejection_per_shown: Option<f64>,
    export_per_accepted: Option<f64>,
    missed_coverage: Option<f64>,
    boundary_edits: HighlightFeedbackBoundarySummary,
    category_counts: BTreeMap<String, u64>,
}

fn feedback_lock() -> &'static Mutex<()> {
    FEEDBACK_FILE_LOCK.get_or_init(|| Mutex::new(()))
}

fn acquire_feedback_file_lock(directory: &Path) -> Result<fs::File, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("編集学習データの保存先を作成できません: {error}"))?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Windows配布版の二重起動時は、同じJSONLへ触る別processをfail-closedにする。
        options.share_mode(0);
    }
    options
        .open(directory.join(LOCK_FILE))
        .map_err(|error| format!("編集学習データは別のTateClipが使用中です: {error}"))
}

fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 160
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':')
        });
    if valid {
        Ok(())
    } else {
        Err(format!("{label}が不正です"))
    }
}

fn validate_range(label: &str, range: &HighlightFeedbackRange) -> Result<(), String> {
    const MAX_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
    if range.start.is_finite()
        && range.end.is_finite()
        && range.start >= 0.0
        && range.end >= range.start
        && range.end <= MAX_SECONDS
    {
        Ok(())
    } else {
        Err(format!("{label}が不正です"))
    }
}

fn validate_event(event: &HighlightFeedbackEvent) -> Result<(), String> {
    if event.schema_version != 1 {
        return Err("未対応の編集学習データ形式です".to_string());
    }
    validate_identifier("eventId", &event.event_id)?;
    chrono::DateTime::parse_from_rfc3339(&event.occurred_at)
        .map_err(|_| "occurredAtが不正です".to_string())?;
    for (label, value) in [
        ("analysisId", event.analysis_id.as_deref()),
        ("candidateId", event.candidate_id.as_deref()),
        ("clipId", event.clip_id.as_deref()),
    ] {
        if let Some(value) = value {
            validate_identifier(label, value)?;
        }
    }
    if event.candidate_index.is_some_and(|index| index > 100_000) {
        return Err("candidateIndexが不正です".to_string());
    }
    if event
        .analysis_mode
        .as_deref()
        .is_some_and(|mode| mode != "fast" && mode != "subtitle")
    {
        return Err("analysisModeが不正です".to_string());
    }
    if let Some(range) = &event.initial_range {
        validate_range("initialRange", range)?;
    }
    if let Some(range) = &event.current_range {
        validate_range("currentRange", range)?;
    }
    if let Some(scores) = &event.score_details {
        let percent = |value: f64| value.is_finite() && (0.0..=100.0).contains(&value);
        if !percent(scores.event)
            || !percent(scores.reaction)
            || !percent(scores.clipability)
            || !scores.confidence.is_finite()
            || !(0.0..=1.0).contains(&scores.confidence)
        {
            return Err("scoreDetailsが不正です".to_string());
        }
    }
    if event
        .nearest_candidate_iou
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        return Err("nearestCandidateIouが不正です".to_string());
    }
    if matches!(&event.action, HighlightFeedbackAction::Missed)
        && (event.current_range.is_none() || event.category.is_none())
    {
        return Err("見逃し区間には範囲と種類が必要です".to_string());
    }
    Ok(())
}

fn append_feedback_batch_inner(
    directory: &Path,
    events: &[HighlightFeedbackEvent],
) -> Result<(), String> {
    if events.is_empty() || events.len() > MAX_BATCH_EVENTS {
        return Err("編集学習データの一括件数が不正です".to_string());
    }

    let mut lines = Vec::new();
    for event in events {
        validate_event(event)?;
        serde_json::to_writer(&mut lines, event)
            .map_err(|error| format!("編集学習データを変換できません: {error}"))?;
        lines.push(b'\n');
        if lines.len() > MAX_BATCH_BYTES {
            return Err("編集学習データの一括サイズが大きすぎます".to_string());
        }
    }

    fs::create_dir_all(directory)
        .map_err(|error| format!("編集学習データの保存先を作成できません: {error}"))?;
    let current = directory.join(CURRENT_FILE);
    let previous = directory.join(PREVIOUS_FILE);

    let current_bytes = fs::metadata(&current)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if current_bytes.saturating_add(lines.len() as u64) > MAX_FEEDBACK_BYTES {
        if previous.exists() {
            fs::remove_file(&previous)
                .map_err(|error| format!("古い編集学習データを整理できません: {error}"))?;
        }
        if current.exists() {
            fs::rename(&current, &previous)
                .map_err(|error| format!("編集学習データをローテーションできません: {error}"))?;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&current)
        .map_err(|error| format!("編集学習データを開けません: {error}"))?;
    file.write_all(&lines)
        .map_err(|error| format!("編集学習データを書き込めません: {error}"))?;
    file.flush()
        .map_err(|error| format!("編集学習データを確定できません: {error}"))?;
    Ok(())
}

fn append_feedback_inner(directory: &Path, event: &HighlightFeedbackEvent) -> Result<(), String> {
    append_feedback_batch_inner(directory, std::slice::from_ref(event))
}

fn feedback_status_inner(directory: &Path) -> HighlightFeedbackStatus {
    HighlightFeedbackStatus {
        bytes: fs::metadata(directory.join(CURRENT_FILE))
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        previous_bytes: fs::metadata(directory.join(PREVIOUS_FILE))
            .map(|metadata| metadata.len())
            .unwrap_or(0),
    }
}

fn category_name(category: &MissedHighlightCategory) -> &'static str {
    match category {
        MissedHighlightCategory::Victory => "victory",
        MissedHighlightCategory::Failure => "failure",
        MissedHighlightCategory::Surprise => "surprise",
        MissedHighlightCategory::Comedy => "comedy",
        MissedHighlightCategory::Explanation => "explanation",
        MissedHighlightCategory::Other => "other",
    }
}

fn rounded(value: f64, digits: i32) -> f64 {
    let scale = 10_f64.powi(digits);
    (value * scale).round() / scale
}

fn feedback_summary_inner(directory: &Path) -> HighlightFeedbackSummary {
    let mut summary = HighlightFeedbackSummary {
        schema_version: 1,
        ..Default::default()
    };
    let mut events = Vec::new();
    for path in [directory.join(PREVIOUS_FILE), directory.join(CURRENT_FILE)] {
        let Ok(file) = fs::File::open(path) else {
            continue;
        };
        for line in BufReader::new(file).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    match serde_json::from_str::<HighlightFeedbackEvent>(&line) {
                        Ok(event) if validate_event(&event).is_ok() => events.push(event),
                        _ => summary.invalid_line_count += 1,
                    }
                }
                Ok(_) => {}
                Err(_) => summary.invalid_line_count += 1,
            }
        }
    }

    events.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    let mut seen_event_ids = HashSet::new();
    let mut shown = HashSet::new();
    let mut clip_to_candidate: HashMap<String, String> = HashMap::new();
    let mut final_states: HashMap<String, &'static str> = HashMap::new();
    let mut initial_ranges: HashMap<String, HighlightFeedbackRange> = HashMap::new();
    let mut current_ranges: HashMap<String, HighlightFeedbackRange> = HashMap::new();

    for event in events {
        if !seen_event_ids.insert(event.event_id.clone()) {
            continue;
        }
        summary.valid_event_count += 1;

        if matches!(&event.action, HighlightFeedbackAction::Missed) {
            summary.missed_ranges += 1;
            if event.nearest_candidate_iou.unwrap_or(0.0) < 0.3 {
                summary.uncovered_missed_ranges += 1;
            }
            if let Some(category) = &event.category {
                *summary
                    .category_counts
                    .entry(category_name(category).to_string())
                    .or_insert(0) += 1;
            }
            continue;
        }

        if matches!(&event.action, HighlightFeedbackAction::Adopted) {
            if let (Some(candidate_id), Some(clip_id)) = (&event.candidate_id, &event.clip_id) {
                clip_to_candidate.insert(clip_id.clone(), candidate_id.clone());
            }
        }
        let candidate_id = event.candidate_id.clone().or_else(|| {
            event
                .clip_id
                .as_ref()
                .and_then(|clip_id| clip_to_candidate.get(clip_id).cloned())
        });
        let Some(candidate_id) = candidate_id else {
            continue;
        };

        if let Some(range) = event.initial_range {
            initial_ranges.entry(candidate_id.clone()).or_insert(range);
        }
        if matches!(
            &event.action,
            HighlightFeedbackAction::Trimmed | HighlightFeedbackAction::Exported
        ) {
            if let Some(range) = event.current_range {
                current_ranges.insert(candidate_id.clone(), range);
            }
        }

        match &event.action {
            HighlightFeedbackAction::Shown => {
                shown.insert(candidate_id.clone());
                final_states.entry(candidate_id).or_insert("shown");
            }
            HighlightFeedbackAction::Restored => {
                final_states.insert(candidate_id, "shown");
            }
            HighlightFeedbackAction::Adopted => {
                final_states.insert(candidate_id, "adopted");
            }
            HighlightFeedbackAction::Unadopted | HighlightFeedbackAction::Rejected => {
                final_states.insert(candidate_id, "rejected");
            }
            HighlightFeedbackAction::Exported => {
                final_states.insert(candidate_id, "exported");
            }
            _ => {}
        }
    }

    summary.shown_candidates = shown.len() as u64;
    summary.adopted_candidates = final_states
        .values()
        .filter(|state| **state == "adopted")
        .count() as u64;
    summary.rejected_candidates = final_states
        .values()
        .filter(|state| **state == "rejected")
        .count() as u64;
    summary.exported_candidates = final_states
        .values()
        .filter(|state| **state == "exported")
        .count() as u64;
    let accepted = summary.adopted_candidates + summary.exported_candidates;
    let accepted_from_shown = final_states
        .iter()
        .filter(|(candidate_id, state)| {
            shown.contains(*candidate_id) && matches!(**state, "adopted" | "exported")
        })
        .count() as u64;
    let rejected_from_shown = final_states
        .iter()
        .filter(|(candidate_id, state)| shown.contains(*candidate_id) && **state == "rejected")
        .count() as u64;
    if summary.shown_candidates > 0 {
        summary.accepted_per_shown = Some(rounded(
            accepted_from_shown as f64 / summary.shown_candidates as f64,
            4,
        ));
        summary.rejection_per_shown = Some(rounded(
            rejected_from_shown as f64 / summary.shown_candidates as f64,
            4,
        ));
    }
    if accepted > 0 {
        summary.export_per_accepted = Some(rounded(
            summary.exported_candidates as f64 / accepted as f64,
            4,
        ));
    }
    if summary.missed_ranges > 0 {
        summary.missed_coverage = Some(rounded(
            (summary.missed_ranges - summary.uncovered_missed_ranges) as f64
                / summary.missed_ranges as f64,
            4,
        ));
    }

    let mut start_delta = 0.0;
    let mut end_delta = 0.0;
    let mut boundary_samples = 0_u64;
    for (candidate_id, current) in current_ranges {
        if final_states.get(&candidate_id) == Some(&"rejected") {
            continue;
        }
        let Some(initial) = initial_ranges.get(&candidate_id) else {
            continue;
        };
        start_delta += (current.start - initial.start).abs();
        end_delta += (current.end - initial.end).abs();
        boundary_samples += 1;
    }
    summary.boundary_edits.sample_count = boundary_samples;
    if boundary_samples > 0 {
        summary.boundary_edits.mean_start_delta_seconds =
            rounded(start_delta / boundary_samples as f64, 3);
        summary.boundary_edits.mean_end_delta_seconds =
            rounded(end_delta / boundary_samples as f64, 3);
    }
    summary
}

fn clear_feedback_inner(directory: &Path) -> Result<(), String> {
    for path in [directory.join(CURRENT_FILE), directory.join(PREVIOUS_FILE)] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("編集学習データを削除できません: {error}")),
        }
    }
    Ok(())
}

fn feedback_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("highlight-feedback"))
        .map_err(|error| format!("編集学習データの保存先を確認できません: {error}"))
}

#[tauri::command]
pub async fn append_highlight_feedback(
    app: tauri::AppHandle,
    event: HighlightFeedbackEvent,
) -> Result<(), String> {
    let directory = feedback_directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = feedback_lock()
            .lock()
            .map_err(|_| "編集学習データの排他制御に失敗しました".to_string())?;
        let _file_guard = acquire_feedback_file_lock(&directory)?;
        append_feedback_inner(&directory, &event)
    })
    .await
    .map_err(|error| format!("編集学習データの保存処理が停止しました: {error}"))?
}

#[tauri::command]
pub async fn append_highlight_feedback_batch(
    app: tauri::AppHandle,
    events: Vec<HighlightFeedbackEvent>,
) -> Result<(), String> {
    let directory = feedback_directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = feedback_lock()
            .lock()
            .map_err(|_| "編集学習データの排他制御に失敗しました".to_string())?;
        let _file_guard = acquire_feedback_file_lock(&directory)?;
        append_feedback_batch_inner(&directory, &events)
    })
    .await
    .map_err(|error| format!("編集学習データの一括保存処理が停止しました: {error}"))?
}

#[tauri::command]
pub async fn get_highlight_feedback_status(
    app: tauri::AppHandle,
) -> Result<HighlightFeedbackStatus, String> {
    let directory = feedback_directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = feedback_lock()
            .lock()
            .map_err(|_| "編集学習データの排他制御に失敗しました".to_string())?;
        let _file_guard = acquire_feedback_file_lock(&directory)?;
        Ok(feedback_status_inner(&directory))
    })
    .await
    .map_err(|error| format!("編集学習データの確認処理が停止しました: {error}"))?
}

#[tauri::command]
pub async fn get_highlight_feedback_summary(
    app: tauri::AppHandle,
) -> Result<HighlightFeedbackSummary, String> {
    let directory = feedback_directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = feedback_lock()
            .lock()
            .map_err(|_| "編集学習データの排他制御に失敗しました".to_string())?;
        let _file_guard = acquire_feedback_file_lock(&directory)?;
        Ok(feedback_summary_inner(&directory))
    })
    .await
    .map_err(|error| format!("編集学習データの集計処理が停止しました: {error}"))?
}

#[tauri::command]
pub async fn clear_highlight_feedback(app: tauri::AppHandle) -> Result<(), String> {
    let directory = feedback_directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = feedback_lock()
            .lock()
            .map_err(|_| "編集学習データの排他制御に失敗しました".to_string())?;
        let _file_guard = acquire_feedback_file_lock(&directory)?;
        clear_feedback_inner(&directory)
    })
    .await
    .map_err(|error| format!("編集学習データの削除処理が停止しました: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event() -> HighlightFeedbackEvent {
        HighlightFeedbackEvent {
            schema_version: 1,
            event_id: "event-1".to_string(),
            occurred_at: "2026-08-03T00:00:00Z".to_string(),
            action: HighlightFeedbackAction::Adopted,
            analysis_id: Some("analysis-1".to_string()),
            candidate_id: Some("analysis-1:candidate:0".to_string()),
            clip_id: Some("clip-1".to_string()),
            candidate_index: Some(0),
            analysis_mode: Some("fast".to_string()),
            initial_range: Some(HighlightFeedbackRange {
                start: 4.0,
                end: 12.0,
            }),
            current_range: Some(HighlightFeedbackRange {
                start: 4.0,
                end: 12.0,
            }),
            score_details: Some(HighlightFeedbackScores {
                event: 72.0,
                reaction: 81.0,
                clipability: 63.0,
                confidence: 0.8,
            }),
            category: None,
            nearest_candidate_iou: None,
        }
    }

    #[test]
    fn stores_only_the_validated_jsonl_event_and_can_clear_it() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-highlight-feedback-{}",
            uuid::Uuid::new_v4()
        ));
        append_feedback_inner(&directory, &event()).unwrap();
        let stored = fs::read_to_string(directory.join(CURRENT_FILE)).unwrap();
        assert!(stored.contains("\"action\":\"adopted\""));
        assert!(!stored.contains("sourcePath"));
        assert!(feedback_status_inner(&directory).bytes > 0);
        clear_feedback_inner(&directory).unwrap();
        assert_eq!(feedback_status_inner(&directory).bytes, 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_content_fields_and_invalid_ranges_at_the_native_boundary() {
        let with_content = r#"{
            "schemaVersion":1,
            "eventId":"event-1",
            "occurredAt":"2026-08-03T00:00:00Z",
            "action":"shown",
            "sourcePath":"C:/private/movie.mp4"
        }"#;
        assert!(serde_json::from_str::<HighlightFeedbackEvent>(with_content).is_err());

        let mut invalid = event();
        invalid.current_range = Some(HighlightFeedbackRange {
            start: 8.0,
            end: 7.0,
        });
        assert!(validate_event(&invalid).is_err());
    }

    #[test]
    fn appends_a_batch_under_one_lock_and_rejects_empty_batches() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-highlight-feedback-batch-{}",
            uuid::Uuid::new_v4()
        ));
        let mut second = event();
        second.event_id = "event-2".to_string();
        second.action = HighlightFeedbackAction::Exported;
        append_feedback_batch_inner(&directory, &[event(), second]).unwrap();
        let stored = fs::read_to_string(directory.join(CURRENT_FILE)).unwrap();
        assert_eq!(stored.lines().count(), 2);
        assert!(append_feedback_batch_inner(&directory, &[]).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn summarizes_final_decisions_boundaries_and_uncovered_misses() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-highlight-feedback-summary-{}",
            uuid::Uuid::new_v4()
        ));
        let mut shown = event();
        shown.event_id = "shown-1".to_string();
        shown.action = HighlightFeedbackAction::Shown;

        let mut adopted = event();
        adopted.event_id = "adopted-1".to_string();

        let mut exported = event();
        exported.event_id = "exported-1".to_string();
        exported.action = HighlightFeedbackAction::Exported;
        exported.candidate_id = None;
        exported.current_range = Some(HighlightFeedbackRange {
            start: 5.0,
            end: 11.0,
        });

        let mut missed = event();
        missed.event_id = "missed-1".to_string();
        missed.action = HighlightFeedbackAction::Missed;
        missed.candidate_id = None;
        missed.clip_id = Some("manual-1".to_string());
        missed.category = Some(MissedHighlightCategory::Comedy);
        missed.nearest_candidate_iou = Some(0.1);

        let mut retained_without_shown = event();
        retained_without_shown.event_id = "adopted-without-shown".to_string();
        retained_without_shown.candidate_id = Some("analysis-1:candidate:9".to_string());
        retained_without_shown.clip_id = Some("clip-9".to_string());

        append_feedback_batch_inner(
            &directory,
            &[shown, adopted, exported, missed, retained_without_shown],
        )
        .unwrap();
        let summary = feedback_summary_inner(&directory);
        assert_eq!(summary.shown_candidates, 1);
        assert_eq!(summary.exported_candidates, 1);
        assert_eq!(summary.missed_ranges, 1);
        assert_eq!(summary.uncovered_missed_ranges, 1);
        assert_eq!(summary.boundary_edits.sample_count, 1);
        assert_eq!(summary.boundary_edits.mean_start_delta_seconds, 1.0);
        assert_eq!(summary.boundary_edits.mean_end_delta_seconds, 1.0);
        assert_eq!(summary.category_counts.get("comedy"), Some(&1));
        assert_eq!(summary.accepted_per_shown, Some(1.0));
        fs::remove_dir_all(directory).unwrap();
    }
}
