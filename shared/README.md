# Shared Types

This directory contains shared types and schemas that are used by both the frontend and backend.

## Usage

### Frontend
```typescript
import { ApiResponse } from '../shared/types'
```

### Backend
Consider using `ts-rs` to generate TypeScript types from Rust structs:

```rust
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
}
```

This will generate TypeScript definitions that stay in sync with your Rust types.
