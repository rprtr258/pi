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
