# 山经图鉴插画：生成与接入指南

这份文档可直接交给其他 AI。目标是给地图右侧的生物条目补充小幅水墨插画：展开时左图右文，图片按需加载。先核对原文，再生成和审图；不是给每座山随机配动物。

## 目录与状态

| 文件／目录 | 用途 |
| --- | --- |
| `index.json` | 网页实际使用的图片清单。只有审查通过、图片确实存在的条目才能加入。 |
| `prompts.json` | 首批生成的完整提示词及九尾狐修订提示词，可直接参考。 |
| `generation-plan.json` | 当前待生成队列，每项含原文、形态要求、完整提示词和接入提示；数量以该文件为准。 |
| `CANDIDATES.md` | 按五篇山经分组的可读候选总表，附优先级与误画提醒。 |
| 根目录 `*.png` | 已接入图片的生成原图，保留透明通道。 |
| `display/` | 网页使用的 最长边 384 像素的 透明 PNG 缩略图。 |
| `candidates/` | 尚未通过检查的候选，网页不会使用。 |

首批在 2026-11-09 使用内置 imagegen 生成，原图已复制到项目，不依赖生成工具的缓存目录。图片都是依据古文的现代艺术演绎，不是古籍原图或考古复原。

| 状态 | 生物 | 原文位置 | 原图／显示文件 |
| --- | --- | --- | --- |
| 已接入 | 狌狌 | 南山经 · 招摇之山 | `xingxing.png`／`display/xingxing.png` |
| 已接入 | 凤皇 | 南山经 · 丹穴之山 | `phoenix.png`／`display/phoenix.png` |
| 已接入 | 精卫 | 北山经 · 发鸠之山 | `jingwei.png`／`display/jingwei.png` |
| 已接入 | 九尾狐 | 南山经 · 青丘之山 | `nine-tailed-fox.png`／`display/nine-tailed-fox.png` |
| 已接入 | 夫诸 | 中山经 · 敖岸之山 | `fuzhu.png`／`display/fuzhu.png` |
| 已接入 | 旋龟 | 南山经 · 杻阳之山 | `xuangui.png`／`display/xuangui.png` |
| 已接入 | 鹿蜀 | 南山经 · 杻阳之山 | `lushu.png`／`display/lushu.png` |
| 已接入 | 长右 | 南山经 · 长右之山 | `changyou.png`／`display/changyou.png` |
| 已接入 | 蛊雕 | 南山经 · 鹿吴之山 | `gudiao.png`／`display/gudiao.png` |
| 已接入 | 鯥 | 南山经 · 柢山 | `lu-fish.png`／`display/lu-fish.png` |
| 已接入 | 类 | 南山经 · 亶爰之山 | `lei.png`／`display/lei.png` |
| 已接入 | 猼𫍙 | 南山经 · 基山 | `boshi.png`／`display/boshi.png` |
| 已接入 | 灌灌 | 南山经 · 青丘之山 | `guanguan.png`／`display/guanguan.png` |
| 已接入 | 赤鱬 | 南山经 · 青丘之山 | `chiru.png`／`display/chiru.png` |
| 已接入 | 狸力 | 南山经 · 柜山 | `lili.png`／`display/lili.png` |
| 已接入 | 瞿如 | 南山经 · 祷过之山 | `quru.png`／`display/quru.png` |
| 已接入 | 颙 | 南山经 · 令丘之山 | `yong.png`／`display/yong.png` |
| 已接入 | 陆吾 | 西山经 · 昆仑之丘 | `luwu.png`／`display/luwu.png` |
| 已接入 | 毕方 | 西山经 · 章莪之山 | `bifang.png`／`display/bifang.png` |
| 已接入 | 英招 | 西山经 · 槐江之山 | `yingzhao.png`／`display/yingzhao.png` |
| 已接入 | 鸾鸟 | 西山经 · 女床之山 | `luanniao.png`／`display/luanniao.png` |
| 已接入 | 朱厌 | 西山经 · 小次之山 | `zhuyan.png`／`display/zhuyan.png` |
| 已接入 | 土蝼 | 西山经 · 昆仑之丘 | `tulou.png`／`display/tulou.png` |
| 已接入 | 钦原 | 西山经 · 昆仑之丘 | `qinyuan.png`／`display/qinyuan.png` |
| 已接入 | 天狗 | 西山经 · 阴山 | `tiangou.png`／`display/tiangou.png` |
| 已接入 | 穷奇 | 西山经 · 邽山 | `qiongqi.png`／`display/qiongqi.png` |
| 已接入 | 狰 | 西山经 · 章莪之山 | `zheng.png`／`display/zheng.png` |
| 已接入 | 耳鼠 | 北山经 · 丹熏之山 | `ershu.png`／`display/ershu.png` |
| 已接入 | 孟极 | 北山经 · 石者之山 | `mengji.png`／`display/mengji.png` |
| 已接入 | 诸犍 | 北山经 · 单张之山 | `zhujian.png`／`display/zhujian.png` |
| 已接入 | 何罗之鱼 | 北山经 · 谯明之山 | `heluo-fish.png`／`display/heluo-fish.png` |
| 已接入 | 狍鸮 | 北山经 · 钩吾之山 | `paoxiao.png`／`display/paoxiao.png` |
| 已接入 | 天马 | 北山经 · 马成之山 | `tianma.png`／`display/tianma.png` |
| 已接入 | 酸与 | 北山经 · 景山 | `suanyu.png`／`display/suanyu.png` |
| 已接入 | 当康 | 东山经 · 钦山 | `dangkang.png`／`display/dangkang.png` |
| 已接入 | 从从 | 东山经 · 栒状之山 | `congcong.png`／`display/congcong.png` |
| 已接入 | 犰狳 | 东山经 · 馀峩之山 | `qiuyu.png`／`display/qiuyu.png` |
| 已接入 | 朱獳 | 东山经 · 耿山 | `zhuru.png`／`display/zhuru.png` |
| 已接入 | 獙獙 | 东山经 · 姑逢之山 | `bibi.png`／`display/bibi.png` |
| 已接入 | 蠪侄 | 东山经 · 凫丽之山 | `longzhi.png`／`display/longzhi.png` |
| 已接入 | 朏朏 | 中山经 · 霍山 | `feifei.png`／`display/feifei.png` |
| 已接入 | 青耕 | 中山经 · 堇理之山 | `qinggeng.png`／`display/qinggeng.png` |
| 已接入 | 马腹 | 中山经 · 蔓渠之山 | `mafu.png`／`display/mafu.png` |

已接入图片均保留原图、透明缩略图和生成提示词。本轮按用户要求优先生成，`reviewStatus: pending` 表示已生成接入、内容与质量待集中复核；未通过早期审查的历史候选保留在 `candidates/`。

## 下一批建议

共规划四十三种生物的插画工作项，当前**已生成接入 43 项，剩余 0 项待生成**。本轮以生成优先，保存并接入后移出待生成清单，复核状态另行保留。

| 篇章 | 待生成 | 示例 |
| --- | --- | --- |
| 南山经 | 0 项 | 本轮清单已完成 |
| 西山经 | 0 项 | 本轮清单已完成 |
| 北山经 | 0 项 | 本轮清单已完成 |
| 东山经 | 0 项 | 本轮清单已完成 |
| 中山经 | 0 项 | 本轮清单已完成 |

完整清单见 [CANDIDATES.md](CANDIDATES.md)。`generation-plan.json` 的每项 `prompt` 可直接作为生成提示词参考，`sourceExcerpt` 是形态摘录，`sourceQuote` 保留所在山域全文；生成前应互相核对。`catalogueIndexed`、`integrationNote` 和 `suggestedMatch` 说明当前是否已有可关联的生物条目及匹配参考。

一些名字容易误导图像生成：本条“天马”是白犬黑头，“天狗”是狸形白首，“犰狳”是兔形、鸟喙、蛇尾；本清单穷奇采用邽山的牛形猬毛版本。请按原文而非名字或流行图片生成。

后续扩展仅选能在本项目《山经》数据中定位的生物，不凭热门程度混入其他典籍或其他经篇中的形象。原文不明确的颜色、姿态可以写意处理，但不要把创作部分描述为原文事实。

## 统一提示词模板

将“生物描述”替换成队列中的原文形态，原有三张的精确提示词见 `prompts.json`。

```text
用途：中国中学《山海经》图鉴网页中的方形小幅插画，展示尺寸约 100—160 像素。
主体：【生物名】。依据原文：【复制形态原文】。
必须保留：【列明头部、身体、肢体、尾巴、耳朵、翅膀和颜色等关键特征】。
风格：中式水墨写意手绘，干湿墨笔、柔和墨晕，少量石青、石绿、淡赭等传统设色；轮廓清晰，小尺寸仍易辨认。
构图：单个生物完整居中，方形，四周留白；最多保留脚下一小笔地面或岩石。
背景：真正透明，保留 alpha；不要纸张、山水场景或纯色背景。
禁止：文字、数字、书法、印章、水印、边框、霓虹线条、盔甲和未有依据的肢体。
校验重点：【例如恰好九尾／四耳／一足；所有末端均清楚可辨】。
这是依据古文的现代艺术演绎，不是历史复原。
```

数量复杂时，把尾巴或耳朵拉开，宁可线条简练，也不要让它们互相遮挡。不要为了画面“华丽”牺牲关键数量和轮廓。凤皇的五彩纹样可以抽象表达，不要在羽毛上硬塞汉字；这也是艺术演绎，需要保留示意说明。

## 生成后怎么做

1. **核对来源**：读取 `generation-plan.json` 中的原文，必要时再查 `../atlas/mountains.json`。不要修改古籍原文来迎合图片。
2. **生成单个生物**：使用支持透明背景的图像生成工具；在 Codex 中优先遵循 imagegen 技能。不要用 SVG 或文字占位图冒充插画。
3. **检查结果**：人工数肢体、尾巴、耳朵；检查白喙、白耳、赤尾等关键特征。把图片放到浅色与深色背景上分别检查透明边缘。没通过就留在 `candidates/`，不加入 `index.json`。
4. **保存原图**：放到本目录，使用简短英文 ID，例如 `luwu.png`。原图存在时用 `luwu-v2.png`，不要无声覆盖。
5. **制作缩略图**：保留原图，网页只用小图。现有方案是最长边 384 的透明 PNG，单张尽量在 250 KB 以内；也可以采用透明 WebP，并在清单中写对扩展名。不要把所有大图转成 Base64 塞进 JavaScript。
6. **更新清单**：在 `index.json` 的 `assets` 中追加记录，写好原文名称、匹配条件、图片路径、短描述和来源。
7. **验证与登记**：确认对应生物展开后图片出现、文字仍可读、滚动条同步、缺图时仍能阅读文字。最后更新本 README 和队列状态。

现有缩图工具不需要安装 Pillow。Windows 下在项目根目录执行：

```powershell
pwsh.exe -NoLogo -NoProfile -NonInteractive -File sketches/3/atlas/prepare_images.ps1 -Source static/bestiary/luwu.png -Destination static/bestiary/display/luwu.png
```

脚本保留透明通道，只在 `static/bestiary/` 内创建新文件，输出已存在时会拒绝覆盖。它仅做尺寸优化，不修改生物形态。不要在学生端运行该工具；这是素材准备步骤。

## 如何关联到网页

示例配置如下。`file` 相对于当前目录，网页在展开对应条目后才请求图片。

```json
{
  "id": "luwu",
  "name": "陆吾",
  "names": ["陆吾"],
  "textIncludes": [],
  "file": "display/luwu.png",
  "originalFile": "luwu.png",
  "alt": "虎身、九尾、人面、虎爪的陆吾水墨示意",
  "description": "原文记载陆吾具有虎的身体和爪、人面以及九条尾巴，守卫昆仑。",
  "sourceBook": "西山经",
  "sourceMountain": "昆仑之丘"
}
```

- `names`：匹配生物条目的原文名称；异体名可并列，例如 `凤皇`、`凤凰`。
- `textIncludes`：名字未明示时，可用足够独特的原文片段匹配，例如九尾狐用 `其状如狐而九尾`。
- **不要把“未具名生物”写进 `names`**，否则许多不同生物会误用同一张图。
- 可选 `displayName`：仅用于有必要的展示名称，例如 `九尾狐（依形态称呼）`。不要借此篡改原文。
- `description`：用自己的话简述原文形态；不添加无依据的能力，也不把古籍中的食用、医疗说法当成现代建议。
- 原图、网页小图和清单应一起保留。待生成项目不应放进 `assets`。

修改 `index.json` 后刷新页面即可，不需要改渲染代码。图片没找到时，界面会保留文字并隐藏失效图片区域。

## 当前实现与检查入口

- 文字与图片：`../atlas/world.js`，通过 `index.json` 匹配。
- 图文样式与水墨滚动条：`../atlas/world.css`。
- 右侧滚动行为：`../atlas/reading.js`；原生滚动容器，支持滚轮、触控、拖动墨痕滑块及键盘。
- 独立预览：项目根目录双击 `sketches/3/start-preview.cmd`，使用已确认的 `shanhai-ai` 环境，不需要 Node.js 服务。
- 资源和名称检查：`sketches/3/atlas/check_bestiary.mjs`。
- 透明通道检查：`sketches/3/atlas/check_image_alpha.ps1`。

自动检查不能代替审图。当前已接入 43 张缩略图合计约 8.80 MB，未展开时不请求图片。浏览器中的最终排版与真实设备滚动手感仍需实机查看。
