use fff_search::{
    FilePicker, FilePickerOptions, FuzzySearchOptions, GrepMode, GrepSearchOptions, PaginationArgs,
    QueryParser, SharedFilePicker, SharedFrecency, SharedQueryTracker,
};
use fff_search::frecency::FrecencyTracker;
use fff_search::query_tracker::QueryTracker;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use super::launch::uri_to_path;
use super::search::SearchResult;

#[derive(Clone)]
struct FffHandles {
    shared_picker: SharedFilePicker,
    shared_query: SharedQueryTracker,
    scan_ready: Arc<AtomicBool>,
}

static FFF_INDEXES: OnceLock<Mutex<HashMap<String, FffHandles>>> = OnceLock::new();
static FFF_UNAVAILABLE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static FFF_INIT: OnceLock<Mutex<()>> = OnceLock::new();

fn indexes() -> &'static Mutex<HashMap<String, FffHandles>> {
    FFF_INDEXES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn unavailable_roots() -> &'static Mutex<HashSet<String>> {
    FFF_UNAVAILABLE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn init_lock() -> &'static Mutex<()> {
    FFF_INIT.get_or_init(|| Mutex::new(()))
}

fn root_key(root_uri: &str) -> String {
    std::path::Path::new(&uri_to_path(root_uri))
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| uri_to_path(root_uri))
}

fn frecency_db_dir(root_path: &str) -> PathBuf {
    let hash = Sha256::digest(root_path.as_bytes());
    let hex = hash.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    home.join(".gharargah").join("fff").join(&hex[..16])
}

fn ensure_handles(root_uri: &str) -> Option<FffHandles> {
    let key = root_key(root_uri);
    if unavailable_roots()
        .lock()
        .map(|g| g.contains(&key))
        .unwrap_or(false)
    {
        return None;
    }

    if let Ok(guard) = indexes().lock() {
        if let Some(handles) = guard.get(&key) {
            return Some(handles.clone());
        }
    }
    let _init = init_lock().lock().ok()?;
    if unavailable_roots()
        .lock()
        .map(|guard| guard.contains(&key))
        .unwrap_or(false)
    {
        return None;
    }
    if let Ok(guard) = indexes().lock() {
        if let Some(handles) = guard.get(&key) {
            return Some(handles.clone());
        }
    }

    let db_dir = frecency_db_dir(&key);
    if std::fs::create_dir_all(&db_dir).is_err() {
        unavailable_roots().lock().ok()?.insert(key.clone());
        return None;
    }

    let shared_picker = SharedFilePicker::default();
    let shared_frecency = SharedFrecency::default();
    let shared_query = SharedQueryTracker::default();

    let frecency = match FrecencyTracker::open(db_dir.join("frecency")) {
        Ok(f) => f,
        Err(_) => {
            unavailable_roots().lock().ok()?.insert(key.clone());
            return None;
        }
    };
    if shared_frecency.init(frecency).is_err() {
        unavailable_roots().lock().ok()?.insert(key.clone());
        return None;
    }

    let query_tracker = match QueryTracker::open(db_dir.join("history")) {
        Ok(q) => q,
        Err(_) => {
            unavailable_roots().lock().ok()?.insert(key.clone());
            return None;
        }
    };
    if shared_query.init(query_tracker).is_err() {
        unavailable_roots().lock().ok()?.insert(key.clone());
        return None;
    }

    let mut options = FilePickerOptions::default();
    options.base_path = key.clone();
    options.watch = true;

    if FilePicker::new_with_shared_state(
        shared_picker.clone(),
        shared_frecency,
        options,
    )
    .is_err()
    {
        unavailable_roots().lock().ok()?.insert(key.clone());
        return None;
    }

    let scan_ready = Arc::new(AtomicBool::new(false));
    let handles = FffHandles {
        shared_picker: shared_picker.clone(),
        shared_query,
        scan_ready: scan_ready.clone(),
    };

    if let Ok(mut guard) = indexes().lock() {
        guard.insert(key, handles.clone());
    }
    std::thread::spawn(move || {
        let ready = shared_picker.wait_for_indexing_complete(Duration::from_secs(30));
        scan_ready.store(ready, Ordering::Release);
    });
    Some(handles)
}

pub fn dispose_fff_index(root_uri: &str) {
    let key = root_key(root_uri);
    if let Ok(mut guard) = indexes().lock() {
        guard.remove(&key);
    }
    if let Ok(mut guard) = unavailable_roots().lock() {
        guard.remove(&key);
    }
}

pub fn is_fff_scan_ready(root_uri: &str) -> bool {
    let key = root_key(root_uri);
    if unavailable_roots()
        .lock()
        .map(|g| g.contains(&key))
        .unwrap_or(false)
    {
        return true;
    }
    if let Ok(guard) = indexes().lock() {
        if let Some(handles) = guard.get(&key) {
            return handles.scan_ready.load(Ordering::Relaxed);
        }
    }
    false
}

pub fn warm_fff_index(root_uri: &str) -> bool {
    ensure_handles(root_uri).is_some()
}

pub fn fff_list_files(root_uri: &str, max_files: usize) -> Option<Vec<String>> {
    let handles = ensure_handles(root_uri)?;
    let picker_guard = handles.shared_picker.read().ok()?;
    let picker = picker_guard.as_ref()?;
    let mut paths = Vec::new();
    let page_size = 5000usize;
    let mut page_index = 0usize;
    while paths.len() < max_files {
        let offset = page_index * page_size;
        let result = picker.glob(
            "**/*",
            FuzzySearchOptions {
                pagination: PaginationArgs {
                    offset,
                    limit: page_size,
                },
                ..Default::default()
            },
        );
        if result.items.is_empty() {
            break;
        }
        for item in &result.items {
            paths.push(item.relative_path(picker));
            if paths.len() >= max_files {
                break;
            }
        }
        if result.items.len() < page_size {
            break;
        }
        page_index += 1;
    }
    paths.sort();
    Some(paths)
}

pub fn fff_file_search(
    root_uri: &str,
    query: &str,
    page_size: usize,
    current_file: Option<&str>,
) -> Option<Vec<String>> {
    let handles = ensure_handles(root_uri)?;
    let picker_guard = handles.shared_picker.read().ok()?;
    let picker = picker_guard.as_ref()?;
    let qt_guard = handles.shared_query.read().ok()?;
    let parser = QueryParser::default();
    let parsed = parser.parse(query);
    let result = picker.fuzzy_search(
        &parsed,
        qt_guard.as_ref(),
        FuzzySearchOptions {
            current_file,
            pagination: PaginationArgs {
                offset: 0,
                limit: page_size,
            },
            ..Default::default()
        },
    );
    Some(
        result
            .items
            .iter()
            .map(|item| item.relative_path(picker))
            .collect(),
    )
}

pub fn fff_grep(
    root_uri: &str,
    query: &str,
    case_sensitive: bool,
    regex: bool,
    fuzzy: bool,
) -> Option<Vec<SearchResult>> {
    if query.trim().is_empty() {
        return Some(Vec::new());
    }
    let handles = ensure_handles(root_uri)?;
    let picker_guard = handles.shared_picker.read().ok()?;
    let picker = picker_guard.as_ref()?;
    let parser = QueryParser::default();
    let parsed = parser.parse(query);
    let mode = if fuzzy {
        GrepMode::Fuzzy
    } else if regex {
        GrepMode::Regex
    } else {
        GrepMode::PlainText
    };
    let grep_result = picker.grep(
        &parsed,
        &GrepSearchOptions {
            mode,
            smart_case: !case_sensitive && !fuzzy,
            page_limit: 200,
            max_matches_per_file: 200,
            ..Default::default()
        },
    );
    let mut results = Vec::new();
    for m in grep_result.matches {
        if results.len() >= 200 {
            break;
        }
        let file = grep_result.files.get(m.file_index)?;
        results.push(SearchResult {
            path: file.relative_path(picker),
            line: m.line_number as u32,
            column: (m.col + 1) as u32,
            preview: m.line_content.trim_end().to_string(),
        });
    }
    Some(results)
}

pub fn fff_track_access(root_uri: &str, query: &str, selected_path: &str) {
    let Some(handles) = ensure_handles(root_uri) else {
        return;
    };
    let Ok(mut qt_guard) = handles.shared_query.write() else {
        return;
    };
    let Some(qt) = qt_guard.as_mut() else {
        return;
    };
    let root = root_key(root_uri);
    let root_path = Path::new(&root);
    let file_path = root_path.join(selected_path);
    let _ = qt.track_query_completion(query, root_path, &file_path);
}
