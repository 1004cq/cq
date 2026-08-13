# 机器人语音功能需求（来自 Grok 分享链接）

## 核心需求
自建 IM 即时通讯项目的官方机器人账号通过 AstrBot（OneBot v11）实现：
1. **发送语音功能（TTS）**：机器人回复时可以发送语音消息
2. **识别语音功能（STT）**：机器人能接收并识别用户发送的语音消息

## 工作流程

### 语音识别（STT）流程
用户发送语音消息 → 自建IM前端录制语音 → 通过 OneBot v11 `[CQ:record]` 发送给 AstrBot → AstrBot 调用 STT 转文字 → LLM 处理 → 回复

### 语音发送（TTS）流程  
LLM 生成文字回复 → AstrBot 调用 TTS 生成音频 → ffmpeg 转格式 → 通过 OneBot v11 `[CQ:record,file=xxx]` 发送 → 自建IM后端接收 → 推送给前端 → 前端播放语音

## 关键技术点

### OneBot v11 协议层面
- 发送语音：`send_msg` / `send_group_msg` 接口需支持 `record` / `voice` 消息段
- 接收语音：用户语音消息需转换为 OneBot `[CQ:record]` 格式推送给 AstrBot
- 语音文件格式：通常需要 silk/amr/ogg/wav/mp3

### 自建IM需要适配的部分
1. **后端 OneBot 适配层**：
   - 处理 AstrBot 发来的 `record` 类型消息段（包含音频文件路径/URL/base64）
   - 将音频文件转发给前端客户端
   - 用户发送语音时，将语音转为 OneBot `record` 消息段推送给 AstrBot

2. **前端**：
   - 接收并播放机器人发来的语音消息
   - 发送语音消息时，上传音频文件到后端

### AstrBot 配置（用户自行在 AstrBot WebUI 完成）
- 配置 STT 提供商（如 OpenAI Whisper）
- 配置 TTS 提供商（如 OpenAI TTS、Edge TTS）
- 在自定义规则中启用 TTS/STT
- 安装 ffmpeg
