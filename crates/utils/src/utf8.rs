/// Incremental UTF-8 decoder for chunked byte streams.
///
/// This decoder avoids introducing replacement characters when a multibyte
/// code point is split across chunks. Invalid byte sequences are still decoded
/// lossily as `U+FFFD` to preserve forward progress.
#[derive(Debug, Default, Clone)]
pub struct Utf8LossyDecoder {
    pending: Vec<u8>,
}

impl Utf8LossyDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode one chunk and keep incomplete trailing UTF-8 bytes for next call.
    pub fn decode_chunk(&mut self, chunk: &[u8]) -> String {
        self.decode_internal(chunk, false)
    }

    /// Flush decoder state at end-of-stream.
    ///
    /// If trailing bytes remain and do not form valid UTF-8, they are emitted
    /// as a single replacement character.
    pub fn finish(&mut self) -> String {
        self.decode_internal(&[], true)
    }

    fn decode_internal(&mut self, chunk: &[u8], finalize: bool) -> String {
        let mut data = Vec::with_capacity(self.pending.len() + chunk.len());
        data.extend_from_slice(&self.pending);
        data.extend_from_slice(chunk);
        self.pending.clear();

        if data.is_empty() {
            return String::new();
        }

        let mut output = String::new();
        let mut offset = 0usize;

        while offset < data.len() {
            match std::str::from_utf8(&data[offset..]) {
                Ok(valid_tail) => {
                    output.push_str(valid_tail);
                    break;
                }
                Err(err) => {
                    let valid_len = err.valid_up_to();
                    if valid_len > 0 {
                        let valid = &data[offset..offset + valid_len];
                        output.push_str(std::str::from_utf8(valid).unwrap_or(""));
                    }
                    offset += valid_len;

                    match err.error_len() {
                        Some(invalid_len) => {
                            output.push('\u{FFFD}');
                            offset = offset.saturating_add(invalid_len);
                        }
                        None => {
                            if finalize {
                                output.push('\u{FFFD}');
                            } else {
                                self.pending.extend_from_slice(&data[offset..]);
                            }
                            break;
                        }
                    }
                }
            }
        }

        output
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8LossyDecoder;

    #[test]
    fn decodes_multibyte_split_across_chunks_without_replacement() {
        // "你" = E4 BD A0
        let mut decoder = Utf8LossyDecoder::new();
        assert_eq!(decoder.decode_chunk(&[0xE4]), "");
        assert_eq!(decoder.decode_chunk(&[0xBD]), "");
        assert_eq!(decoder.decode_chunk(&[0xA0]), "你");
        assert_eq!(decoder.finish(), "");
    }

    #[test]
    fn decodes_invalid_bytes_lossily() {
        let mut decoder = Utf8LossyDecoder::new();
        let out = decoder.decode_chunk(&[b'a', 0x80, b'b']);
        assert_eq!(out, "a\u{FFFD}b");
        assert_eq!(decoder.finish(), "");
    }

    #[test]
    fn finish_flushes_incomplete_sequence_as_replacement() {
        let mut decoder = Utf8LossyDecoder::new();
        assert_eq!(decoder.decode_chunk(&[0xE4, 0xBD]), "");
        assert_eq!(decoder.finish(), "\u{FFFD}");
    }

    #[test]
    fn completes_pending_sequence_with_next_chunk() {
        let mut decoder = Utf8LossyDecoder::new();
        assert_eq!(decoder.decode_chunk("中".as_bytes().split_at(2).0), "");
        assert_eq!(decoder.decode_chunk("中".as_bytes().split_at(2).1), "中");
        assert_eq!(decoder.finish(), "");
    }
}
