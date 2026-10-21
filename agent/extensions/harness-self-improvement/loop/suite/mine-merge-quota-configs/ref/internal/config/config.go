package config

// AutoQuotaLimits holds the merged automatic quota settings: every field
// previously spread across the two separate quota configs.
type AutoQuotaLimits struct {
	Enabled               bool `json:"enabled"`
	DefaultQuota          int  `json:"default_quota"`
	MaxRequestsPerDay     int  `json:"max_requests_per_day"`
	MaxConcurrentRequests int  `json:"max_concurrent_requests"`
}

// Config aggregates all application configuration.
type Config struct {
	AutoQuota AutoQuotaLimits `json:"auto_quota_limits"`
}
