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
