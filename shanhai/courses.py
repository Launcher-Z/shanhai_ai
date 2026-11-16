"""学习首页的课程目录及当前课堂开放进度。"""

# 当前课堂已开放至第9课；开放只影响入口，不代表完成。
UNLOCKED_LESSON = 9


def _lesson(number, title, intro, activity_titles, knowledge):
    # 开放与完成分别判断：可以进入纸页，不代表学生已经完成任务。
    available = number <= UNLOCKED_LESSON
    return {
        "id": f"lesson-{number}", "number": number, "title": title, "intro": intro,
        "knowledge": knowledge, "available": available,
        "activities": [
            {"id": f"lesson-{number}-task-{index}", "title": name,
             "optional": (number, index) == (9, 2),
             "progress_mode": "worksheet",
             "available": available, "completed": False,
             # 第6课三项实验共用纸页入口，体验不等同于提交完成。
             "content_type": ({1: "image-math", 2: "image-edge", 3: "image-hog"}.get(index)
                              if number == 6 else {1: "neural-zero-one", 2: "neural-digits"}.get(index)
                              if number == 7 else "creation" if number in {8,9}
                              else "image-code" if (number, index) == (1, 1)
                              else "pixel-paint" if (number, index) == (1, 2)
                              else "pixel-redraw" if (number, index) == (1, 3)
                              else "animal-identification" if (number, index) == (2, 1)
                              else "animal-classifier" if (number, index) in {(2, 2), (4, 1)}
                              else "animal-review" if (number, index) in {(3, 1), (4, 2)}
                              else "animal-improvement" if (number, index) == (3, 2)
                              else {1:"classification-tree",2:"classification-knn"}.get(index) if number == 5 else None)}
            for index, name in enumerate(activity_titles, start=1)
        ],
    }


COURSE_VOLUMES = [
    {
        "id": "volume-1", "number": "一", "title": "图像与数据", "word": "象",
        "paper": "#e8dfc9", "accent": "#814937", "image": "ink-mountains.png",
        "lessons": [
            _lesson(1, "图像的数字密码", "放大一幅图像，观察像素与数值的关系；再用像素绘制山海形象，理解计算机如何记录图像。",
                    ["像素与数值探索", "给小熊猫戴礼帽", "观察展示后再绘制"],
                    ["像素", "分辨率", "图像数值"]),
            _lesson(2, "人与机器如何识图", "先说出自己识别动物的依据，再训练金丝猴与雪豹分类器，用测试结果比较人和机器的识图方式。",
                    ["人工识别与判断依据", "训练并测试动物分类器"],
                    ["图像分类", "训练集", "测试集"]),
            _lesson(3, "用数据改进识别", "从识别错误中寻找线索，调整训练图片并重新训练，用相同的测试集检验改进是否有效。",
                    ["复盘结果与改进因素", "重新训练与对照实验"],
                    ["数据质量", "样本多样性", "对照实验"]),
        ],
    },
    {
        "id": "volume-2", "number": "二", "title": "让机器看见", "word": "识",
        "paper": "#d8e4df", "accent": "#365c60", "image": "ink-sea.png",
        "lessons": [
            _lesson(4, "当分类器遇见异兽", "用四类现实动物训练分类器，再让山海异兽接受测试；对比全班结果，思考数据、算法与算力的边界。",
                    ["四类动物与异兽测试", "全班结果对比与分析"],
                    ["多分类", "特征线索", "算法与算力"]),
            _lesson(5, "分类器的判断方法", "搭建决策树，模拟 KNN 的邻近判断，比较两种分类方法如何利用特征作出选择。",
                    ["构建决策树", "模拟 KNN 并比较 K 值"],
                    ["决策树", "KNN", "K 值"]),
            _lesson(6, "从像素中提取特征", "尝试图像运算、轮廓提取和 HOG 方向统计，看像素怎样转化为可供分类器使用的特征。",
                    ["图像数字运算", "体验轮廓提取", "HOG 方向统计与特征"],
                    ["像素运算", "轮廓提取", "HOG 特征"]),
            _lesson(7, "神经网络如何学习", "从 0—1 到 0—9 数字识别，观察单层网络如何通过加权计算与反馈调整判断。",
                    ["体验 0—1 单层网络", "体验 0—9 识别与局限"],
                    ["加权计算", "学习反馈", "单层网络"]),
        ],
    },
    {
        "id": "volume-3", "number": "三", "title": "再绘山海", "word": "绘",
        "paper": "#e9d9cd", "accent": "#855443", "image": "ink-tree.png",
        "lessons": [
            _lesson(8, "循文绘兽：初绘山海", "先请 AI 识别异兽，再依据《山海经》原文生成形象；对照原文评价结果，完成第一次山海创作。",
                    ["AI 识别异兽并记录", "原文生成与作品评价"],
                    ["AI 识图", "原文转译", "图像评价"]),
            _lesson(9, "炼词成画：再绘山海", "为身边或喜爱的动物赋予山海灵气，组织清晰的提示词；自由观展积累表达，再修改作品并复盘AI建议。",
                    ["赋予动物灵气 · 初创", "自由观展与采集", "修改定稿与AI反思"],
                    ["结构化提示词", "迭代优化", "对比评价"]),
        ],
    },
]

# 卷内有已开放课时即可翻阅；全部课时未开放时整卷遮罩。
for volume in COURSE_VOLUMES:
    volume["available"] = any(lesson["available"] for lesson in volume["lessons"])
