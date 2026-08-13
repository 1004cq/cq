package auth

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// SessionCache Session 缓存条目
type SessionCache struct {
	UserID    string
	ExpiresAt time.Time
}

// Verifier Session Token 验证器
// 通过查询 SQLite 的 UserSession 表验证 token，并使用本地缓存减少 DB 查询
type Verifier struct {
	db    *sql.DB
	mu    sync.RWMutex
	cache map[string]*SessionCache
}

// NewVerifier 创建 Session 验证器
func NewVerifier(dbPath string) (*Verifier, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&mode=ro")
	if err != nil {
		return nil, fmt.Errorf("open auth db: %w", err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(3)

	v := &Verifier{
		db:    db,
		cache: make(map[string]*SessionCache),
	}

	// 启动缓存清理协程
	go v.cleanupLoop()

	return v, nil
}

// Verify 验证 Session Token，返回 userId
func (v *Verifier) Verify(token string) (string, error) {
	// 先查缓存
	v.mu.RLock()
	if cached, ok := v.cache[token]; ok {
		if time.Now().Before(cached.ExpiresAt) {
			v.mu.RUnlock()
			return cached.UserID, nil
		}
	}
	v.mu.RUnlock()

	// 查数据库
	var userID string
	var expiresAt *time.Time
	err := v.db.QueryRow(
		`SELECT userId, expiresAt FROM "UserSession" WHERE token = ? LIMIT 1`,
		token,
	).Scan(&userID, &expiresAt)

	if err == sql.ErrNoRows {
		return "", fmt.Errorf("invalid session token")
	}
	if err != nil {
		return "", fmt.Errorf("query session: %w", err)
	}

	// 检查是否过期
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return "", fmt.Errorf("session expired")
	}

	// 写入缓存（TTL 30 秒）
	v.mu.Lock()
	v.cache[token] = &SessionCache{
		UserID:    userID,
		ExpiresAt: time.Now().Add(30 * time.Second),
	}
	v.mu.Unlock()

	return userID, nil
}

// Close 关闭数据库连接
func (v *Verifier) Close() error {
	return v.db.Close()
}

// cleanupLoop 定期清理过期缓存
func (v *Verifier) cleanupLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		v.mu.Lock()
		for token, cached := range v.cache {
			if now.After(cached.ExpiresAt) {
				delete(v.cache, token)
			}
		}
		v.mu.Unlock()
	}
}
