---
name: mine-merge-quota-configs
description: Merge two similar Go config structs (quota_requests_limits and autoquota_limits) into a single auto_quota_limits config without losing any fields
timeout_s: 120
---

Your workspace starts empty. First, recreate the existing (broken) Go module by creating the following files with exactly this content:

#### `go.mod`

```
module example.com/teams-quotas

go 1.22
```

#### `internal/config/config.go`

```go
package config

// QuotaRequestsLimits holds per-user request quotas.
type QuotaRequestsLimits struct {
	MaxRequestsPerDay     int `json:"max_requests_per_day"`
	MaxConcurrentRequests int `json:"max_concurrent_requests"`
}

// AutoQuotaLimits holds automatic quota adjustment settings.
type AutoQuotaLimits struct {
	Enabled      bool `json:"enabled"`
	DefaultQuota int `json:"default_quota"`
}

// Config aggregates all application configuration.
type Config struct {
	QuotaRequests QuotaRequestsLimits `json:"quota_requests_limits"`
	AutoQuota     AutoQuotaLimits     `json:"auto_quota_limits"`
}
```

#### `internal/config/app.go`

```go
package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// LoadQuotaRequestsLimits reads the quota_requests_limits config from path.
func LoadQuotaRequestsLimits(path string) (QuotaRequestsLimits, error) {
	var limits QuotaRequestsLimits
	data, err := os.ReadFile(path)
	if err != nil {
		return limits, fmt.Errorf("read quota_requests_limits: %w", err)
	}
	if err := json.Unmarshal(data, &limits); err != nil {
		return limits, fmt.Errorf("parse quota_requests_limits: %w", err)
	}
	return limits, nil
}

// LoadAutoQuotaLimits reads the autoquota_limits config from path.
func LoadAutoQuotaLimits(path string) (AutoQuotaLimits, error) {
	var limits AutoQuotaLimits
	data, err := os.ReadFile(path)
	if err != nil {
		return limits, fmt.Errorf("read autoquota_limits: %w", err)
	}
	if err := json.Unmarshal(data, &limits); err != nil {
		return limits, fmt.Errorf("parse autoquota_limits: %w", err)
	}
	return limits, nil
}
```

#### `internal/config/app_test.go`

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadQuotaRequestsLimits(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "quota_requests_limits")
	content := `{"max_requests_per_day": 100, "max_concurrent_requests": 5}`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := LoadQuotaRequestsLimits(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.MaxRequestsPerDay != 100 || got.MaxConcurrentRequests != 5 {
		t.Fatalf("unexpected limits: %+v", got)
	}
}

func TestLoadAutoQuotaLimits(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "autoquota_limits")
	content := `{"enabled": true, "default_quota": 10}`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := LoadAutoQuotaLimits(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.Enabled || got.DefaultQuota != 10 {
		t.Fatalf("unexpected limits: %+v", got)
	}
}
```

Once these files exist, the task is:

In this Go module, the config package at internal/config/ contains two similar configs that are loaded separately: `quota_requests_limits` (struct `QuotaRequestsLimits`, loader `LoadQuotaRequestsLimits`) and `autoquota_limits` (struct `AutoQuotaLimits`, loader `LoadAutoQuotaLimits`).

Refactor them into a single config, leaving only `auto_quota_limits`:

1. Define a single `AutoQuotaLimits` struct in internal/config/config.go that carries ALL fields previously spread across both structs (`Enabled`, `DefaultQuota`, `MaxRequestsPerDay`, `MaxConcurrentRequests`) with their existing JSON tags. Do not drop or rename any field.
2. Remove the `QuotaRequestsLimits` type and the `LoadQuotaRequestsLimits` loader entirely — no dead code left behind.
3. `LoadAutoQuotaLimits` in internal/config/app.go must be the only loader, reading the `autoquota_limits` file, and must populate the merged fields.
4. The `Config` aggregate struct must expose only the merged auto quota config (no separate quota-requests field).
5. Update internal/config/app_test.go so it tests the merged loader: it must cover all four fields and must no longer reference the removed loader.

The trap to avoid: a naive fix deletes the quota-requests code and its fields along with it. That is wrong — every field from both original configs must survive in the merged one.

Verification: `go build ./...` and `go test ./internal/config/...` must both succeed.
