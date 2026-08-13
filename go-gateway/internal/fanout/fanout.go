package fanout

import (
	"sync"
)

// Task 扇出任务
type Task func()

// WorkerPool 并发受限的 Worker 池
// 用于控制扇出推送的并发度，防止万人群推送时打满 CPU
type WorkerPool struct {
	sem chan struct{} // 信号量，控制并发数
}

// New 创建 Worker 池
// concurrency: 最大并发数
func New(concurrency int) *WorkerPool {
	return &WorkerPool{
		sem: make(chan struct{}, concurrency),
	}
}

// Submit 提交任务（阻塞直到有可用 Worker）
func (p *WorkerPool) Submit(task Task) {
	p.sem <- struct{}{}
	go func() {
		defer func() { <-p.sem }()
		task()
	}()
}

// SubmitAndWait 提交一批任务并等待全部完成
func (p *WorkerPool) SubmitAndWait(tasks []Task) {
	var wg sync.WaitGroup
	for _, task := range tasks {
		wg.Add(1)
		t := task
		p.sem <- struct{}{}
		go func() {
			defer func() {
				<-p.sem
				wg.Done()
			}()
			t()
		}()
	}
	wg.Wait()
}

// GroupFanoutManager 群扇出管理器
// 为不同规模的群分配不同的 Worker 池
type GroupFanoutManager struct {
	largeGroupPool    *WorkerPool
	smallGroupPool    *WorkerPool
	largeGroupThreshold int
}

// NewGroupFanoutManager 创建群扇出管理器
func NewGroupFanoutManager(largeThreshold, largeConcurrency, smallConcurrency int) *GroupFanoutManager {
	return &GroupFanoutManager{
		largeGroupPool:      New(largeConcurrency),
		smallGroupPool:      New(smallConcurrency),
		largeGroupThreshold: largeThreshold,
	}
}

// GetPool 根据群成员数量获取对应的 Worker 池
func (m *GroupFanoutManager) GetPool(memberCount int) *WorkerPool {
	if memberCount >= m.largeGroupThreshold {
		return m.largeGroupPool
	}
	return m.smallGroupPool
}
