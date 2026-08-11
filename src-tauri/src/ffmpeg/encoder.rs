/// FFmpeg エンコーダ設定
/// GPU タイプに応じてエンコーダ名と追加引数を返す
pub struct EncoderConfig {
    pub codec: &'static str,
    pub extra_args: Vec<String>,
}

impl EncoderConfig {
    pub fn from_gpu_type(gpu_type: &str) -> Self {
        let gt = gpu_type.to_uppercase();
        if gt.contains("NVIDIA") {
            Self {
                codec: "h264_nvenc",
                // NVENCの品質プリセット (p4は速度と品質のバランス)
                extra_args: vec![
                    "-preset".to_string(),
                    "p4".to_string(),
                    "-b:v".to_string(),
                    "5M".to_string(),
                ],
            }
        } else if gt.contains("AMD") || gt.contains("RADEON") {
            Self {
                codec: "h264_amf",
                // AMFの品質プリセット (speed は高速処理)
                extra_args: vec![
                    "-quality".to_string(),
                    "speed".to_string(),
                    "-b:v".to_string(),
                    "5M".to_string(),
                ],
            }
        } else {
            Self::cpu_fallback()
        }
    }

    pub fn cpu_fallback() -> Self {
        Self {
            // Windows標準のMedia Foundationを使う。GPL専用のlibx264には依存しない。
            codec: "h264_mf",
            extra_args: vec![
                "-rate_control".to_string(),
                "cbr".to_string(),
                "-b:v".to_string(),
                "8M".to_string(),
            ],
        }
    }

    /// Media Foundationが使えないWindows環境向けの純ソフトウェア最終フォールバック。
    pub fn software_fallback() -> Self {
        Self {
            codec: "libopenh264",
            extra_args: vec!["-b:v".to_string(), "8M".to_string()],
        }
    }

    #[cfg(test)]
    fn is_cpu(&self) -> bool {
        self.codec == "h264_mf" || self.codec == "libopenh264"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nvidia_encoder() {
        let enc = EncoderConfig::from_gpu_type("NVIDIA");
        assert_eq!(enc.codec, "h264_nvenc");
        assert!(!enc.is_cpu());
    }

    #[test]
    fn test_amd_encoder() {
        let enc = EncoderConfig::from_gpu_type("AMD");
        assert_eq!(enc.codec, "h264_amf");
        assert!(!enc.is_cpu());
    }

    #[test]
    fn test_cpu_encoder() {
        let enc = EncoderConfig::from_gpu_type("CPU");
        assert_eq!(enc.codec, "h264_mf");
        assert!(enc.is_cpu());
    }

    #[test]
    fn test_cpu_fallback() {
        let enc = EncoderConfig::cpu_fallback();
        assert_eq!(enc.codec, "h264_mf");
        assert!(enc.is_cpu());
        assert!(enc.extra_args.contains(&"8M".to_string()));
    }

    #[test]
    fn test_software_fallback() {
        let enc = EncoderConfig::software_fallback();
        assert_eq!(enc.codec, "libopenh264");
        assert!(enc.is_cpu());
    }

    #[test]
    fn test_unknown_gpu_defaults_to_cpu() {
        let enc = EncoderConfig::from_gpu_type("Intel");
        assert!(enc.is_cpu());
    }

    #[test]
    fn test_case_insensitive() {
        let enc = EncoderConfig::from_gpu_type("nvidia");
        assert_eq!(enc.codec, "h264_nvenc");
    }
}
