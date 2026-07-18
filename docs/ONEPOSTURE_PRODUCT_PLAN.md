# OnePosture 产品与商业化方案

状态：v2 实施基线（2026-07-18）

## 产品决定

- 产品名：**OnePosture**。
- 一句话定位：隐私优先、完全本地运行的开源坐姿提醒器。
- 产品源码继续保留在 `makerjackie/pose-nudge`，以完整保留上游历史和贡献者署名。
- `OneApps-Studio/OneApps` 维护产品目录、官网介绍和下载入口；未来如需迁移仓库，应使用 GitHub transfer 保留完整历史，而不是重新复制源码。
- 产品不是医疗器械，不宣称诊断、治疗颈椎或肩部疾病。

`OnePosture` 比 `Pose Nudge` 更符合 OneApps 的命名体系，也比 `OneNudge` 更直接地表达产品用途。迁移时必须保留原作者、原仓库和 AGPL-3.0 许可证声明。

## 免费版与 Pro

检测修复、通知权限、菜单栏状态和一个可靠提醒通道属于产品应有的基本质量，不作为付费墙。

### Free

- 无限时长的本地姿态监测
- 多帧校准和稳定后的基本检测
- 菜单栏运行、暂停与当前状态
- 通知权限诊断、测试提醒
- 系统通知和顶部悬浮提醒
- 本地数据与隐私保护

### Pro（一次买断）

- 屏幕变暗、边缘光、全屏柔和遮罩等沉浸式提醒
- 自定义声音和组合提醒
- 多显示器提醒
- 提醒升级策略、冷却时间、工作时段与勿扰计划
- 高级趋势、导出和多个姿态配置

价格：国内 **¥39 永久版**，海外 **US$4.99 lifetime**。不做订阅，不用“修 bug”作为付费理由。¥29 仅保留为限量早期支持者价格，不作为长期标价。

## 可靠提醒架构

`ReminderEngine` 是深模块：它只接收稳定的姿态信号、时间和偏好，输出一次提醒事件。它不依赖 Tauri、macOS 通知或具体 UI。

提醒通道通过 adapter 接入：

- `NativeNotificationAdapter`：系统通知；需要先检查/申请权限。
- `FloatingReminderAdapter`：始终置顶的顶部悬浮窗；是 Free 的可靠兜底。
- `ScreenDimAdapter`：柔和屏幕变暗；Pro。
- `SoundAdapter`：声音；自定义组合属于 Pro。
- `TrayStatusAdapter`：菜单栏 tooltip、状态文本和快捷操作。

提醒触发使用“持续不良 + 冷却”状态机，不再按每个坏帧每 10 秒轰炸。系统通知失败或系统展示样式关闭时，悬浮窗仍能工作。

## 激活与支付架构

应用继续以 AGPL-3.0 开源并允许收费。首发直接复用私有的 01MVP 数字商品系统发放激活码，不新建独立购买网站，也暂不接入 Waffo。客户端与 01MVP 之间保持清晰的 license seam：

```text
OnePosture (AGPL client)
  -> POST https://01mvp.com/api/v1/activations
  <- signed entitlement token

01MVP Digital Products (private service)
  -> digital product order
  -> license_code delivery
  -> activation lookup + entitlement signing
```

约束：

- 闭源逻辑保留在私有的 01MVP 仓库和服务端，不复制、链接或嵌入 AGPL 客户端代码。
- 客户端的激活逻辑仍是 AGPL；不能把激活当成不可绕过的 DRM。
- 服务只返回产品权限，不上传摄像头画面、姿态关键点或监测历史。
- 客户端缓存由服务签发的 Ed25519 entitlement，离线校验；永久版不依赖每次启动联网。
- token 至少包含 `license_id`、`product_id`、`edition`、`issued_at`、`expires_at`、`device_limit`、`signature`。
- 支付退款或密钥滥用可以在联网刷新时更新状态，但离线宽限不能破坏正常永久用户体验。

首发在 01MVP 中创建 `oneposture-pro` 数字商品，使用现有的 `license_code` 模式预生成并交付激活码。购买完成后，01MVP 将已交付且订单有效的激活码兑换成统一的离线 entitlement。当前阶段以跑通“创建商品 -> 下单 -> 发码 -> 激活 -> 离线验证”为目标；Waffo 或其他支付渠道以后只作为支付 adapter 接入，不进入首发验收范围。

首发购买页、订单页、激活页、交付邮件和客户端激活结果必须同时适配简体中文、繁体中文、英文、日文、韩文和土耳其文。激活接口返回稳定错误码，由客户端完成本地化，不返回写死的中英文错误文案。

## 发布结构

1. 在当前仓库发布 OnePosture v2 源码和经过签名、公证的安装包。
2. 在 OneApps monorepo 的 `Catalog/apps/oneposture/` 维护产品元数据，官网从 catalog 生成产品页。
3. 新包名使用 `oneposture`，macOS bundle id 使用 `studio.oneapps.oneposture`；旧 `com.dduldduck.pose-nudge` 不原地覆盖。
4. 只有在确认组织权限、release 重定向和 issue 迁移都可靠后，才考虑把当前仓库整体 transfer 到 OneApps Studio 组织。

## 首发验收

- 16:9 相机画面不会被拉伸为正方形。
- 评分和最终稳定状态来自同一份信号。
- 低置信度帧不会写入坏姿态记录或触发提醒。
- 不良姿态需要持续一段时间才提醒，恢复后状态会清除。
- 首次启用系统通知时明确申请权限，并能在设置中检查、重试和发送测试提醒。
- 即使 macOS 系统通知设为“无”，顶部悬浮提醒仍可见。
- 菜单栏能区分监测中、已暂停、姿态偏移和相机/模型异常。
- Pro token 可以离线验证；无 token 时 Free 功能完整可用。
