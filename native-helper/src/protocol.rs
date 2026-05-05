use std::fmt;
use std::io::{self, Read, Write};

#[derive(Debug)]
pub enum ProtocolError {
    Io(io::Error),
    Json(serde_json::Error),
    TruncatedHeader,
    TruncatedPayload { expected: usize, actual: usize },
    LengthOverflow(usize),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
            Self::TruncatedHeader => write!(formatter, "frame header ended before 4 bytes"),
            Self::TruncatedPayload { expected, actual } => {
                write!(
                    formatter,
                    "frame payload ended after {actual} of {expected} bytes"
                )
            }
            Self::LengthOverflow(length) => {
                write!(formatter, "frame payload is too large: {length} bytes")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

impl From<io::Error> for ProtocolError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ProtocolError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub fn write_frame_to_vec(value: &serde_json::Value) -> Result<Vec<u8>, serde_json::Error> {
    let payload = serde_json::to_vec(value)?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn read_frame_from_slice(bytes: &[u8]) -> Result<serde_json::Value, ProtocolError> {
    if bytes.len() < 4 {
        return Err(ProtocolError::TruncatedHeader);
    }

    let mut length_bytes = [0_u8; 4];
    length_bytes.copy_from_slice(&bytes[..4]);
    let length = u32::from_le_bytes(length_bytes) as usize;
    let actual = bytes.len().saturating_sub(4);

    if actual < length {
        return Err(ProtocolError::TruncatedPayload {
            expected: length,
            actual,
        });
    }

    Ok(serde_json::from_slice(&bytes[4..4 + length])?)
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<serde_json::Value>, ProtocolError> {
    let mut header = [0_u8; 4];
    let mut read = 0;

    while read < header.len() {
        match reader.read(&mut header[read..]) {
            Ok(0) if read == 0 => return Ok(None),
            Ok(0) => return Err(ProtocolError::TruncatedHeader),
            Ok(count) => read += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ProtocolError::Io(error)),
        }
    }

    let length = u32::from_le_bytes(header) as usize;
    let mut payload = vec![0_u8; length];
    let mut read = 0;

    while read < length {
        match reader.read(&mut payload[read..]) {
            Ok(0) => {
                return Err(ProtocolError::TruncatedPayload {
                    expected: length,
                    actual: read,
                });
            }
            Ok(count) => read += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ProtocolError::Io(error)),
        }
    }

    Ok(Some(serde_json::from_slice(&payload)?))
}

pub fn write_frame<W: Write>(
    writer: &mut W,
    value: &serde_json::Value,
) -> Result<(), ProtocolError> {
    let frame = write_frame_to_vec(value)?;
    writer.write_all(&frame)?;
    Ok(())
}

pub fn run_stdio_bridge() -> Result<(), ProtocolError> {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();

    while let Some(request) = read_frame(&mut stdin)? {
        write_frame(&mut stdout, &request)?;
        stdout.flush()?;
    }

    Ok(())
}
