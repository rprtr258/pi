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
