package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Store 数据库访问层
type Store struct {
	db *sql.DB
}

// GroupMessage 群消息
type GroupMessage struct {
	ID         string
	GroupID    string
	Seq        int64
	SenderID   string
	SenderName string
	MsgType    string
	Content    string
	ReplyToID  *string
	Extra      *string
	CreatedAt  time.Time
	IsRevoked  bool
}

// GroupMember 群成员
type GroupMember struct {
	GroupID    string
	UserID     string
	Role       string
	Nickname   *string
	LastAckSeq int64
	JoinTime   time.Time
}

// New 创建数据库连接
func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// 连接池配置
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return &Store{db: db}, nil
}

// Close 关闭数据库连接
func (s *Store) Close() error {
	return s.db.Close()
}

// GetGroupLastSeq 获取群最新序列号
func (s *Store) GetGroupLastSeq(groupID string) (int64, error) {
	var seq int64
	err := s.db.QueryRow(`SELECT lastMsgSeq FROM "Group" WHERE id = ?`, groupID).Scan(&seq)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return seq, err
}

// IsGroupMember 检查用户是否是群成员
func (s *Store) IsGroupMember(groupID, userID string) (bool, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(1) FROM "GroupMember" WHERE groupId = ? AND userId = ?`,
		groupID, userID,
	).Scan(&count)
	return count > 0, err
}

// GetGroupMemberIDs 获取群所有成员 ID
func (s *Store) GetGroupMemberIDs(groupID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT userId FROM "GroupMember" WHERE groupId = ?`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// BatchInsertMessages 批量插入群消息
func (s *Store) BatchInsertMessages(msgs []GroupMessage) error {
	if len(msgs) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO "GroupMessage" (id, groupId, seq, senderId, senderName, msgType, content, replyToId, extra, createdAt, isRevoked)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
	`)
	if err != nil {
		return fmt.Errorf("prepare stmt: %w", err)
	}
	defer stmt.Close()

	var maxSeq int64
	for _, msg := range msgs {
		_, err := stmt.Exec(
			msg.ID, msg.GroupID, msg.Seq, msg.SenderID, msg.SenderName,
			msg.MsgType, msg.Content, msg.ReplyToID, msg.Extra,
			msg.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		)
		if err != nil {
			return fmt.Errorf("insert msg: %w", err)
		}
		if msg.Seq > maxSeq {
			maxSeq = msg.Seq
		}
	}

	// 更新群最新序列号
	_, err = tx.Exec(
		`UPDATE "Group" SET lastMsgSeq = ?, lastMsgTime = ? WHERE id = ?`,
		maxSeq, msgs[len(msgs)-1].CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"), msgs[0].GroupID,
	)
	if err != nil {
		return fmt.Errorf("update group seq: %w", err)
	}

	return tx.Commit()
}

// PullMessages 拉取群历史消息（读扩散）
func (s *Store) PullMessages(groupID, userID string, afterSeq, beforeSeq int64, limit int) ([]GroupMessage, bool, int64, error) {
	// 获取成员加入时间
	var joinTime time.Time
	var lastAckSeq int64
	err := s.db.QueryRow(
		`SELECT joinTime, lastAckSeq FROM "GroupMember" WHERE groupId = ? AND userId = ?`,
		groupID, userID,
	).Scan(&joinTime, &lastAckSeq)
	if err == sql.ErrNoRows {
		return nil, false, 0, fmt.Errorf("非群成员")
	}
	if err != nil {
		return nil, false, 0, err
	}

	// 获取群最新序列号
	latestSeq, err := s.GetGroupLastSeq(groupID)
	if err != nil {
		return nil, false, 0, err
	}

	var query string
	var args []interface{}

	if beforeSeq > 0 {
		query = `SELECT id, groupId, seq, senderId, senderName, msgType, content, replyToId, extra, createdAt, isRevoked
				 FROM "GroupMessage" WHERE groupId = ? AND seq < ? ORDER BY seq DESC LIMIT ?`
		args = []interface{}{groupID, beforeSeq, limit + 1}
	} else if afterSeq > 0 {
		query = `SELECT id, groupId, seq, senderId, senderName, msgType, content, replyToId, extra, createdAt, isRevoked
				 FROM "GroupMessage" WHERE groupId = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
		args = []interface{}{groupID, afterSeq, limit + 1}
	} else {
		query = `SELECT id, groupId, seq, senderId, senderName, msgType, content, replyToId, extra, createdAt, isRevoked
				 FROM "GroupMessage" WHERE groupId = ? ORDER BY seq DESC LIMIT ?`
		args = []interface{}{groupID, limit + 1}
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, false, 0, err
	}
	defer rows.Close()

	var msgs []GroupMessage
	for rows.Next() {
		var m GroupMessage
		var createdAtStr string
		err := rows.Scan(&m.ID, &m.GroupID, &m.Seq, &m.SenderID, &m.SenderName,
			&m.MsgType, &m.Content, &m.ReplyToID, &m.Extra, &createdAtStr, &m.IsRevoked)
		if err != nil {
			return nil, false, 0, err
		}
		m.CreatedAt, _ = time.Parse("2006-01-02T15:04:05.000Z", createdAtStr)
		// 过滤加入时间之前的消息
		if !m.CreatedAt.Before(joinTime) {
			msgs = append(msgs, m)
		}
	}

	hasMore := len(msgs) > limit
	if hasMore {
		msgs = msgs[:limit]
	}

	// 如果是倒序查询，反转结果
	if beforeSeq > 0 || (beforeSeq == 0 && afterSeq == 0) {
		for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
			msgs[i], msgs[j] = msgs[j], msgs[i]
		}
	}

	return msgs, hasMore, latestSeq, rows.Err()
}

// UpdateAckSeq 更新成员已读序列号
func (s *Store) UpdateAckSeq(groupID, userID string, ackSeq int64) (int64, error) {
	_, err := s.db.Exec(
		`UPDATE "GroupMember" SET lastAckSeq = ? WHERE groupId = ? AND userId = ?`,
		ackSeq, groupID, userID,
	)
	if err != nil {
		return 0, err
	}

	latestSeq, err := s.GetGroupLastSeq(groupID)
	if err != nil {
		return 0, err
	}

	unread := latestSeq - ackSeq
	if unread < 0 {
		unread = 0
	}
	return unread, nil
}

// GetUserGroups 获取用户所在的群 ID 列表
func (s *Store) GetUserGroups(userID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT groupId FROM "GroupMember" WHERE userId = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groupIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		groupIDs = append(groupIDs, id)
	}
	return groupIDs, rows.Err()
}
