# 学习首页素材

已采用第二轮的“书签侧栏”，课程名称与活动来自教学目录中的《项目整体规划.md》。目录按 3 卷组织已有的 9 课时、23 项任务，具体活动实现与开放规则仍待后续开发。

卷一包含第 1—3 课，卷二包含第 4—7 课，卷三包含第 8—9 课。每课提供知识点标签，切换课时时随正文同步更新。顶部卷号、课时和活动都采用无勾的红绿墨圈；本卷所有活动均完成时，卷号墨圈才显示绿色。

## 配色与插画

- 卷一：暖纸 `#e8dfc9`，赭墨 `#814937`，`ink-mountains.png`。
- 卷二：水青 `#d8e4df`，青墨 `#365c60`，`ink-sea.png`。
- 卷三：淡赭红 `#e9d9cd`，赭红墨 `#855443`，`ink-tree.png`。

三张透明插画和古纸纹理由内置 imagegen 生成。古纸、第一卷插画、红绿墨圈沿用 `sketches/2`；原提示词见该目录 README。

本轮新增素材提示词（以内置 imagegen 生成，第一卷插画作为风格参考）：

`ink-sea.png`：Create a NEW companion Chinese shan hai jing ink wash illustration to match the brushwork and antique manuscript feel of the reference, but a different subject. Transparent background, no paper. A fantastical ancient sea: sweeping curling waves, a giant mythical fish with long ribbonlike fins swimming through mist, small scattered rocky islands and clouds, elegant flowing composition concentrated on the right, long thin ribbons of mist extending left. Monochrome charcoal ink and diluted gray wash, sparse subtle dark blue-green ink accents, generous transparent negative space, soft feathered edges. Wide landscape orientation. No writing, seals, UI, modern objects, boats, or frame. This is the second volume's artwork, evoking discovering hidden patterns and identifying mythical creatures.

`ink-tree.png`：Create a NEW companion Chinese shan hai jing ink wash illustration matching the antique brushwork of the reference, with a distinctly different subject. Genuine transparent background, no paper. An ancient fantastical sacred tree rising from sculptural rocks, long twisting branches and elegant curling cloud ribbons, a small long-tailed mythical bird perched among the boughs. Asymmetrical composition concentrated on the right with mist streaming gently toward the left. Charcoal ink, dry brush bark, diluted gray wash, very subtle muted cinnabar touches on a few leaves, expressive fine lines. Wide landscape format, generous transparent negative space, soft feathered edges. No writing, seals, modern objects, UI, or frame. An imaginative yet refined manuscript illustration for the third volume about creativity.

## 山海图纸页浮层

2026-11-09 使用内置 imagegen 新增 `atlas-paper.png` 和带透明通道的 `ink-close.png`，完整提示词保存在同目录 `atlas-assets.json`。两张素材均已保存到项目内，不依赖生成工具缓存。

地图浮层居中，占窗口宽度约 90%、高度约 88%，最大 1320×800；窄屏改为 96% 宽、94% 高以保留操作空间。古纸以背景图承载，中央用极淡的纸色减弱纹理对文字的干扰。水墨关闭图标放在原生按钮内，点击区域为 44×44 像素，保留“关闭山海图”无障碍名称和 Esc 关闭。

## 学生活动纸页预览

活动入口与山海图使用同一组 `paper-dialog` / `paper-dialog-close` 样式，共用已有的 `atlas-paper.png` 和 `ink-close.png`，未新增图片。右侧墨痕滚动条的公共样式放在 `ink-scroll.css`，行为直接复用 `static/atlas/reading.js`；支持滚轮、拖动、点击轨道和方向键。纸页标题依据当前活动 ID 显示，课时导读和知识点沿用现有课程数据，底部淡墨插画对应当前卷。

第 6 课活动一已接入下述图像运算实验，其余活动的正文仍为“活动内容准备中”。打开、滚动和关闭均不改变 `available` / `completed`，不写入学习记录；关闭时回到原入口并保留翻卷位置。

## 第 6 课像素山实验

落日山水由 `image-math/model.mjs` 中的 24×15 RGB 数组生成，包含彩色山体、云、夕阳、水面和倒影；已去掉原图最下方 3 行水面，不缩放上方内容。像素数据不使用生成图片，确保每个可见色块与实际三通道数值一致。右侧以深红、深绿、深蓝三行同时列出 R、G、B 的十进制和 8 位二进制，无需选择通道，不展开位权。格内数值勾选后同时列出 RGB；已移除整体加亮按钮。`pixel-grid.js` 按 RGB 值逐格绘制画布，不使用浏览器图片插值替代数学运算；各对照图采用相同单像素显示尺寸。后续缩小手算完整 RGB 三通道。数字使用设备已有的 Consolas 等宽字体，外围继续沿用古纸与隶书。

四步依次为 RGB 数值热身、固定 2×2 最近邻放大、3×3 均值缩小、3 倍复制再次放大。放大步骤移除所有选择和填空，操作说明直接提示选点与复制；左图下方用实际像素颜色演示 1 格复制为四格，并提供“处理当前”“自动填充”“重播”。手动复制停留后自动移到下一格，自动填充跳过已完成部分。缩小步骤左侧加大原图，右侧直接选点后通过 R、G、B 标签逐通道计算，一次仅呈现九个数和一个答案；标签复用 `ink-circle-red.png`、`ink-circle-green.png` 表示未完成与已完成，下划线表示选中。草稿和完成状态按像素、通道保存，不提供下一像素按钮。完成两个不同像素的全部 RGB 通道后才开放自动，首次自动完成后开放重播，手算记录按坐标去重并在重播后保留。两步都支持暂停；未处理部分保持空白。最后用红褐色轮廓标出颜色发生变化的像素。实验不引入外部依赖，不上传像素、答案或预测，不修改任务完成状态。

`image-math/ink-abacus.svg` 为本地代码绘制的水墨算盘入口，使用噪声位移稍微打散墨线，保留双上珠、五下珠结构。`calculator.mjs` 的古纸弹出计算器复用 `atlas-paper.png`，采用浏览器原生 Popover，支持括号和四则运算，使用递归解析而非 eval。工具只计算学生自己输入的算式，不读取九格数值，也不直接填入答案。

活动 01 的“化图为数”由 `image-math/data-grid.js` 直接读取相同 RGB 数组，在原画框内展示 24×15 个数据格、1080 个通道值。每格三行数字使用深红、深绿、深蓝，上沿色条来自原像素；可滚动查看完整数据、固定行列坐标，选点同步到右侧读数。数据表只创建一次，切回图像不修改数据。显数过渡由 CSS 实现，并支持减少动态效果。

## 活动、课时与整卷锁定

2026-11-10 使用内置 imagegen 生成 `ink-lock-white.png`：白色毛笔水墨绘制的中式横向古锁，PNG 保留透明通道，1536×1024。完整提示词见同目录 `activity-assets.json`；素材已复制到项目，不依赖生成缓存。

`learning.css` 的锁定伪元素将黑白交织的迷雾与透明古锁分层叠放，活动、课时标签、右侧课时内容和整张书页分别使用适合的图标尺寸。迷雾使用本地 `lock-mist.svg`，以偏暗的深灰云团作底，穿插浅白雾丝，通过 SVG 噪声位移与轻度模糊打散轮廓。小条目、课时内容及整卷的雾图高度分别为定位层的 120%、200% 和 176%；增高雾图时不改变面板本体的高度。课时内容中的雾和古锁略向左下方偏移，只调整背景位置，定位层保持在面板内部。SVG 四周留足透明空间，雾集中在中央，不再对矩形容器做 `backdrop-filter`，避免出现方框式模糊边界；古锁自身保持清晰。雾层不向容器外扩展，课时选中状态也不再平移，桌面列表只允许竖向滚动，防止选中后出现横向滚动条；窄屏继续支持横向浏览课时。SVG 为代码绘制的透明素材，无外部请求，也不新增持续动画。整页锁定时不再叠加内部迷雾；课时内容锁定时也不重复叠加活动迷雾。图片仅负责视觉提示，活动的禁用、整卷内部的 `inert` 与打开弹层前的课程状态检查共同控制交互。

当前解锁进度为第 6 课：第一卷与第二卷开放，第 7 课锁定，第三卷整页锁定。卷、课时与活动统一提供布尔字段 `available`，与真实完成字段 `completed` 分开；活动内容开发完成前仍显示准备中。

## 第三方与运行

2026-11-11 使用内置 imagegen 生成透明底水墨重置图标 `ink-reset.png`，替换活动工具区原有的线条箭头。图标为青灰墨色的一笔回旋箭头，保留飞白和自然晕染，以 44×44 像素显示；按钮文字、完成后启用规则和重置行为沿用原实现。完整生成提示词保存在 `reset-assets.json`。

`gsap.min.js` 与 `ScrollTrigger.min.js` 为 GSAP 3.15.1，来自 npm 官方包，保留文件头、包元数据 `package.json` 与包说明 `README.md`。许可见 https://gsap.com/standard-license/。

没有外部 CDN 或在线字体请求。粒子数量 64，上限 30 帧，画布预算约 65 万像素。系统要求减少动态效果时回退为普通课程页面，动画库未加载时页面也可正常阅读。实际机房帧率仍需设备验收。

完成标记必须由真实提交记录提供；当前活动内容准备中，全部初始化为未完成，未接入草图的“标记完成”按钮。
