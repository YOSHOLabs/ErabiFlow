/// Escape a filesystem path for use inside an FFmpeg filter argument.
///
/// Process arguments remain separate from the shell; this escaping is only for
/// FFmpeg's own filter parser, where backslashes, drive colons and quotes have
/// special meaning.
pub(super) fn escape_filter_path(path: &str) -> String {
    path.replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

#[cfg(test)]
mod tests {
    use super::escape_filter_path;

    #[test]
    fn escapes_windows_filter_paths_without_shell_quoting() {
        assert_eq!(
            escape_filter_path("C:\\素材\\creator's font.ttf"),
            "C\\:/素材/creator\\'s font.ttf"
        );
    }
}
