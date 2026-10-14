# 创世小镇 Godtown

**当物理定律是唯一的适应度函数** —— 一个基于 LLM 多智能体的开放式演化（OEE）世界模拟器。
*When the laws of physics are the only fitness function — an LLM multi-agent open-ended evolution world simulator.*

当前版本 **v4.9.0「感知与名望」**（Perception and Standing）。

## 这是什么 / What it is

像素风小镇生活模拟：居民全部由 AI 驱动，在硬编码的物理基底（时间/空间/身体/物质/守恒）之上，行为、社会、文化、制度全部开放涌现——无开发者预定义的类型、容器或触发规则白名单。文化演化的唯一管道是**观念池**（自由文本念头的形成/传播/变异/选择/结晶/遗忘）；跨世代载体是**神经芯**；v4.9.0 加入**信念层**（主观世界模型，允许错误与过时）与**分布式名望场**（无全局声望表）。

- 论文（中英双语预印本）：[docs/创世小镇-预印本-v4.9.0-中英双语.md](docs/创世小镇-预印本-v4.9.0-中英双语.md)
- 系统架构图：[docs/godtown-architecture.svg](docs/godtown-architecture.svg)
- 设计决议录：[改造决议录.md](改造决议录.md) · 计划书：[docs/计划书.md](docs/计划书.md)

## 验证规模 / Verification

- **53 个自检阶段、1431 项断言全部通过**（`npm run selftest`）；浏览器级（CDP）冒烟检查 26 项。
- **确定性**：同 seed（2028）跑 400 游戏日，两个独立进程世界状态逐字段一致。
- **性能**：寻路重写使 180 天模拟从 27.3 s 降至 7.4 s。

## 运行 / Run

```bash
npm install
npm start        # Electron
npm run selftest # 1431 assertions
```

Windows 成品（安装版/便携版 exe）见 [Releases](../../releases)。

## 许可 / License

[MIT](LICENSE) — 允许使用，须保留署名。
