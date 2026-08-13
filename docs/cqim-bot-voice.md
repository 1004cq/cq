# CQIM 中让机器人发送语音的实现方式

结合当前项目代码，**机器人发语音其实已经有一条可用链路**，核心不是前端播放器，而是：先把语音文件变成一个可访问的 URL，再按 `bot_message + msgType=voice + voiceUrl` 的格式推送给前端。

## 一、当前项目里已经具备的能力

| 能力 | 现状 | 代码位置 |
| --- | --- | --- |
| 机器人语音气泡 UI | 已有，可直接播放 `voiceUrl` | `client/src/components/BotVoiceBubble.tsx` |
| 前端接收 BOT 语音消息 | 已有，收到 `msg.type === 'bot_message'` 且 `msgType === 'voice'` 时，会转成 `type: 'voice'` 消息 | `client/src/contexts/AppContext.tsx` |
| 服务端广播 BOT 语音消息 | 已有，支持 `broadcastBotMessageToUser` / `broadcastBotMessageToGroup` | `server/index.ts` |
| 语音静态文件服务 | 已有，`/api/voice/:filename` 可直接被前端播放 | `server/index.ts` |
| 用户语音上传接口 | 已有，`POST /api/voice/upload` 可把 base64 音频保存为可访问文件 | `server/index.ts` |
| OneBot 语音消息兼容 | 已有，可识别 `record` 消息段并转成前端可播放语音消息 | `server/index.ts` |

> 这意味着：**前端展示层基本已经完成**，真正要做的是把机器人生成出来的音频文件正确交给服务端，然后用现有广播格式发出去。

## 二、机器人语音消息的目标数据格式

前端实际识别的是下面这类消息：

```json
{
  "type": "bot_message",
  "chatId": "cBOT",
  "senderId": "BOT",
  "content": "[语音消息]",
  "messageId": "bot-1710000000000",
  "timestamp": 1710000000000,
  "msgType": "voice",
  "voiceUrl": "/api/voice/bot_voice_xxx.mp3",
  "duration": 6
}
```

其中最关键的是三个字段：

| 字段 | 作用 | 必填 |
| --- | --- | --- |
| `msgType` | 告诉前端这是语音消息 | 是 |
| `voiceUrl` | 前端播放器实际拉取的音频地址 | 是 |
| `duration` | 显示时长，可选但建议补齐 | 否 |

## 三、如果你的机器人走 AstrBot / OneBot

这是当前项目里**最省事**的方案，因为代码已经兼容了 `record` 消息段。

机器人只要发出 OneBot 风格的语音段：

```json
{
  "action": "send_private_msg",
  "params": {
    "user_id": "u10001",
    "message": [
      {
        "type": "record",
        "data": {
          "file": "https://your-domain.com/bot/hello.mp3"
        }
      }
    ]
  }
}
```

或者群聊：

```json
{
  "action": "send_group_msg",
  "params": {
    "group_id": 3,
    "message": [
      {
        "type": "record",
        "data": {
          "file": "https://your-domain.com/bot/hello.mp3"
        }
      }
    ]
  }
}
```

服务端会自动执行以下流程：

| 步骤 | 当前服务端行为 |
| --- | --- |
| 1 | 解析 `record` 消息段 |
| 2 | 下载语音文件 |
| 3 | 保存到本地语音目录 |
| 4 | 生成 `publicUrl` |
| 5 | 调用 `broadcastBotMessageToUser/Group` 推送给前端 |

> 也就是说，如果你已经接了 AstrBot，**理论上不需要额外改前端**，只要让机器人回复 `record` 类型消息即可。

## 四、如果你的机器人不是 OneBot，而是你自己写的 AI 服务

这种场景也很简单，建议按下面的三段式实现。

### 1. 先做 TTS，把文本转成音频文件

例如你的服务拿到模型回答文本后：

1. 调用 TTS 服务生成 `mp3` / `wav` / `m4a`
2. 把音频文件保存到 `data/voice/` 或对象存储
3. 拿到一个前端可访问的 URL

你可以使用任意 TTS 提供方，例如：

| 方案 | 适合场景 |
| --- | --- |
| 腾讯云 TTS | 国内环境、延迟稳定 |
| 阿里云智能语音 | 国内环境、接入成熟 |
| Edge TTS / Azure TTS | 英文/多语言声音较多 |
| OpenAI TTS | 已有相关 API 能力时接入方便 |

### 2. 服务端直接广播 BOT 语音消息

当前项目已经有现成方法，最直接就是在服务端机器人回复逻辑里调用：

```ts
broadcastBotMessageToUser(userId, '[语音消息]', {
  voiceUrl: '/api/voice/bot_reply_001.mp3',
  duration: 6,
});
```

或者群聊：

```ts
broadcastBotMessageToGroup(groupId, '[语音消息]', {
  voiceUrl: '/api/voice/bot_reply_001.mp3',
  duration: 6,
});
```

### 3. 如果音频文件是临时生成的，补一个保存函数

建议新增一个类似下面的函数，把 TTS 结果写入现有语音目录：

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function saveBotVoice(buffer: Buffer, ext = '.mp3') {
  const fileName = `bot_voice_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const filePath = path.join(VOICE_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    fileName,
    voiceUrl: `/api/voice/${fileName}`,
  };
}
```

然后你的机器人回复链路就变成：

```ts
const ttsBuffer = await textToSpeech(replyText);
const { voiceUrl } = saveBotVoice(ttsBuffer, '.mp3');

broadcastBotMessageToUser(userId, '[语音消息]', {
  voiceUrl,
  duration: 6,
});
```

## 五、最推荐的落地路径

如果目标是**最快上线**，建议按下面优先级处理：

| 优先级 | 方案 | 原因 |
| --- | --- | --- |
| 1 | 直接让 AstrBot 回复 `record` 段 | 当前项目已经接好了接收、下载、广播、播放整条链路 |
| 2 | 在 `server/index.ts` 里新增一个“文本转语音后广播”的机器人回复分支 | 对现有代码改动最小 |
| 3 | 再补“文字 + 语音双发”能力 | 用户既能看文本，也能点语音听 |

## 六、你真正需要改哪里

如果你是想在 **cqim 现有项目里继续开发**，通常只需要改这几个位置：

| 文件 | 建议改动 |
| --- | --- |
| `server/index.ts` | 在机器人回复逻辑中接入 TTS，并调用 `broadcastBotMessageToUser/Group` |
| `server/index.ts` | 如有需要，新增 `saveBotVoice()` 之类的文件落盘工具 |
| `client/src/contexts/AppContext.tsx` | 一般不用改，已经支持 BOT 语音消息 |
| `client/src/components/BotVoiceBubble.tsx` | 一般不用改，已经能播放语音 |

## 七、结论

当前项目并不是“从零做机器人语音”，而是**已经完成了 70% 以上**。你现在只差最后一段：

> **把机器人生成的语音文件，转换成 `voiceUrl`，然后按 `bot_message + msgType=voice` 推给前端。**

如果你要我直接继续动手做，我建议下一步就做成下面两种之一：

| 选项 | 我可以直接继续帮你做的内容 |
| --- | --- |
| A | 接入 TTS，让机器人回复时自动生成并发送语音 |
| B | 先做一个服务端测试接口，例如 `/api/bot/test-voice`，一键给某个会话发机器人语音，先把链路跑通 |

如果你回复我 **“直接做 A”** 或 **“先做 B”**，我就可以继续在仓库里直接改代码。
