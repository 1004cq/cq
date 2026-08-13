# 外部方案摘录

来源：用户提供的 Grok 共享链接

https://grok.com/share/c2hhcmQtNQ_fb5e2964-020c-47d9-90f1-0ee9bc2791a9

## 与本次贴纸改造直接相关的要点

- 贴纸只预加载最近使用和当前面板内容，其余贴纸通过 LazySticker 与 IntersectionObserver 按需加载。
- 贴纸包按包懒加载，不应一次性渲染全部资源。
- 封面使用小尺寸 WebP，点击或真正进入视口后再加载完整动态资源。
- 静态贴纸优先 WebP；动态贴纸控制资源大小，并减少首屏网络请求。
- 可使用浏览器 Cache API 或 IndexedDB 缓存已下载贴纸，二次打开优先命中本地缓存。
- 贴纸面板与消息发送路径应保持既有 E2EE 规则，不新增明文发送旁路。

## 方案中与 CQIM 整体性能相关的要点

- MongoDB 消息查询使用 conversationId + createdAt/seq 复合索引和 cursor 分页，避免 skip 深分页。
- Redis 负责在线状态、未读数、会话列表和消息热缓存；Go 网关负责 WebSocket 连接与群消息 fan-out。
- 前端消息列表继续使用单一虚拟列表，并结合 IndexedDB 本地缓存实现秒开和增量同步。

## 对当前实现的判断

- 当前 StickerPanel 已有 IntersectionObserver 分批挂载和 Lottie 预加载，但仍将数据、状态、布局、资源处理集中在一个巨石文件中。
- 当前 server/sticker.ts 的 Telegram 输入只解析为 catalog 查找；没有 Bot API 的 getStickerSet/getFile 下载写 manifest 能力。
- 当前后端 manifest 已支持 file/url，但 normalizeStickerUrl 优先使用 url，需要改为 file 优先。
- 当前前端贴纸发送入口在 ChatDetailPage：私聊贴纸走 E2EE envelope，群聊走现有 MLS groupSync，不能修改协议语义。

## 贴纸预加载方案补充

来源：用户提供的第二个 Grok 共享链接

https://grok.com/share/c2hhcmQtNQ_f8ced95b-3f31-4a20-8baf-b4af638716a7

方案的核心思想不是打开面板就把整个贴纸包全部拉取，而是使用 thumbnail 秒出、优先级预取、内存/磁盘缓存和并发上限组合：当前可视区使用 high 优先级，紧邻缓冲区使用 medium，空闲时再用 low；建议网络请求并发约 3，动态动画同时播放约 8 个以内，当前包首批预取约 8 个，预加载窗口保持较小，并在切包时取消旧任务。二次打开应优先命中内存或 Cache API，动画资源需要在缩略图先呈现后淡入；服务端静态资源继续使用长期缓存头，本地 `/api/stickers/files` 优先。

本次实现已落实：`stickerPrefetcher` 的 high/medium 优先级队列、3 路并发、Cache API 写入、Lottie 内存缓存与磁盘缓存、动画最多 4 个同时播放、加载阶段显示 thumb，以及 StickerGrid 接近视口时预取下一批。
