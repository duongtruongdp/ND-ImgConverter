use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[allow(dead_code)]
    #[error("Unsupported format")]
    UnsupportedFormat,
    #[error("Failed to decode image: {0}")]
    DecodeFailed(String),
    #[error("Failed to encode image: {0}")]
    EncodeFailed(String),
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Process was cancelled")]
    Cancelled,
}

impl Serialize for EngineError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}