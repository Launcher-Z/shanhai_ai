# 再绘山海经 · AI 课堂平台

面向中小学人工智能与跨学科教学的本地化课堂实验平台，以《山海经》古籍与山海图鉴为情境主线，覆盖图像编码、动物分类训练与测试、决策树与 KNN、HOG 特征、卷积与神经网络以及 AI 辅助创作等课堂活动，并配套局域网教师控制台与学习札记系统。

## 方式一：直接下载一键包（推荐给授课教师）

如果你只是希望直接在课堂上使用，无需安装 Python 或配置环境：

1. 前往本仓库右侧的 **Releases** 页面，下载最新版本的 Windows 一键包（如 `shanhai-ai-v1.0.1-win64.zip`）。
2. 将压缩包完整解压到任意目录（不要直接在压缩包内运行）。
3. 双击 `启动课堂.bat` 打开图形化启动器，点击 **▶ 启动课堂服务** 即可。

详细操作与备份/重置密码说明可参考目录内的 [使用说明.txt](使用说明.txt)。

## 方式二：从源码运行（推荐给开发者）

### 环境要求

- Python 3.10+（推荐 Python 3.11）
- 如需运行图形化启动器 `launcher.py`，需确保 Python 环境包含 `tkinter`

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/Launcher-Z/shanhai_ai.git
cd shanhai_ai

# 2. 创建并激活虚拟环境
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
# source .venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动方式 A：运行图形化启动器（推荐）
python launcher.py

# 4. 启动方式 B：直接运行服务入口
python app.py
```

### 常用环境变量（直接运行 `app.py` 时生效）

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SHANHAI_RUN_MODE` | `waitress`（局域网课堂模式）或 `dev`（本机调试模式） | `waitress` |
| `SHANHAI_PORT` | 服务监听端口 | `5000` |
| `SHANHAI_THREADS` | Waitress 并发线程数 | `8` |
| `SHANHAI_PROGRESS_LOCKS` | 是否开启课程与札记顺序解锁（`true` / `false`） | `true` |

## 课堂使用流程

1. 启动服务后访问教师控制台：`http://127.0.0.1:5000/teacher`。
2. 首次使用先设置不少于 8 位的教师密码，并创建上课班级。
3. 学生在同一局域网内通过教师机 IP 与端口（如 `http://192.168.x.x:5000`）访问学习首页，选择班级并输入姓名即可进入实验。
4. 课堂数据库与会话密钥默认保存在本地 `data/` 目录（`classroom.sqlite3` 与 `session.key`），已被 `.gitignore` 排除。

## 目录结构

```text
.
├── app.py                 # 服务启动入口
├── launcher.py            # Tkinter 图形化课堂启动器
├── launcher_config.json   # 启动器默认配置
├── requirements.txt       # Python 依赖清单
├── shanhai/               # Flask 应用、路由、数据库与教学逻辑
├── templates/             # 页面模板（学习页、活动页、教师端）
├── static/                # 静态资源、交互脚本、本地模型与图鉴素材
├── worksheets/            # 各课时学习札记题目配置
├── data/                  # 运行时数据库与密钥目录（本地生成）
├── 使用说明.txt           # 一键包教师使用说明
└── 启动课堂.bat           # Windows 一键包启动脚本
```

## 更新说明

### v1.0.1
- **教师台加载性能优化**：开启 SQLite WAL 模式、缓存课程目录与进度节点、消除统计时的嵌套遍历与重复 JSON 解析、启用响应 gzip 压缩，并将「札记分析」改为按单课按需加载（保留「全部课时」切换入口）。
- **教师台交互改进**：
  - 「札记分析」使用左侧全课程目录切换课时（卷一/二/三仅作折叠分组，点回当前课原地收起已展开的活动而不刷新页面），并移除上方冗余的课时下拉框；
  - 像素画（1.2 / 1.3）、创作作品（8.2 / 9.1 / 9.3）及手写样本库（7.2）新增「刷新作品 / 刷新样本」按钮；
  - 「课堂概览」中尚未开始的任务改用浅灰色 `-` 展示，与已开始但未完成的红点区分。
- **局域网 HTTPS 与证书管理**：新增 `shanhai/certs.py` 自动签发局域网自签名 HTTPS 证书；启动器支持勾选 HTTPS 启动（含可关闭的访问提醒弹窗），以及一键导出根证书并附带 `HTTPS证书安装说明.txt`。

## 开源协议与素材声明

- 本项目源代码采用 **MIT License** 开源，详见 [LICENSE](LICENSE)。
- `static/` 下部分暂留的书籍拍摄图片、教学图片及第三方模型/前端库适用独立版权声明，**不纳入 MIT 授权范围**，详见 [NOTICE.md](NOTICE.md)。
