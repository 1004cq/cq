# Apple APNs / 极光 JPush 密钥

## 当前使用的 Auth Key

| 项 | 值 |
|----|-----|
| 文件 | `AuthKey_URP8X87T38.p8` |
| Key ID | `URP8X87T38` |
| Team ID | `4U332QFN6D` |
| Bundle ID | `com.imim.chat` |

## 极光控制台（Token Authentication）

1. 集成设置 → iOS → **Token Authentication 配置**
2. 上传：`AuthKey_URP8X87T38.p8`
3. 填写 Key ID、Team ID、Bundle ID（见上表）
4. AppKey：`2f496988f16573ad08321835`

## imimchat 服务端

`server/apns.ts` 启动时会自动加载本目录下所有 `AuthKey_*.p8`。

环境变量（可选，默认已内置 Team ID / Bundle ID）：

```env
APPLE_TEAM_ID=4U332QFN6D
APPLE_BUNDLE_ID=com.imim.chat
```

**注意：`*.p8` 已加入 `.gitignore`，请勿将私钥提交到 Git。**
