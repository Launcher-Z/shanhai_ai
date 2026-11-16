"""分类方法的教学数据与树快照校验；不把预设的一种搭法当作唯一答案。"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

DATA = json.loads((Path(__file__).resolve().parents[1] / 'static/learning/classification/data.json').read_text(encoding='utf-8'))
ANIMALS = {item['id']: item for item in DATA['animals']}
FEATURES = {item['id']: item for item in DATA['features']}
BEAST_NAMES = ('天狗', '长右', '类', '朱厌')
BEAST_FILES = {'天狗': 'tiangou', '长右': 'changyou', '类': 'lei', '朱厌': 'zhuyan'}
RESULT_LABELS = {'monkey': '金丝猴', 'leopard': '雪豹', 'tie': '平票'}


def tree_data(value):
    """模板只读取已经验证过的结构，旧草稿或空值显示为空。"""
    try:
        data = json.loads(value)
        validate_tree(value)
        return data
    except (ValueError, TypeError):
        return None


def validate_tree(value, required=False, stage=None):
    if not value and not required:
        return
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        raise ValueError('请先带入活动中的决策树。') from None
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('决策树记录格式不正确。')
    ids = data.get('animal_ids')
    if ids not in DATA['stages'] or (stage is not None and ids != DATA['stages'][stage]):
        raise ValueError('请带入本段对应的动物决策树。')
    count = 0

    def visit(node, candidates, depth=0):
        nonlocal count
        count += 1
        if not isinstance(node, dict) or depth > 6 or count > 31:
            raise ValueError('决策树过深或结构不正确。')
        if set(node) == {'animal'} and isinstance(node['animal'], str) and node['animal'] in ids:
            return len(candidates) == 1 and candidates[0] == node['animal']
        if not node:
            return False
        if (set(node) != {'feature', 'yes', 'no'} or not isinstance(node['feature'], str)
                or node['feature'] not in FEATURES):
            raise ValueError('请使用提供的判断条件和动物。')
        yes = [item for item in candidates if node['feature'] in ANIMALS[item]['traits']]
        no = [item for item in candidates if item not in yes]
        # 两边都遍历，空分支或误分的分支不能漏过结构检查。
        left = visit(node['yes'], yes, depth + 1)
        right = visit(node['no'], no, depth + 1)
        return bool(yes and no and left and right)

    complete = visit(data.get('tree'), ids)
    if required and not complete:
        raise ValueError('树还没有正确区分全部动物，请回活动检查分支后重新带入。')


def fixed_votes(k):
    """从固定点位计算邻居数，避免题目和实验各维护一份答案。"""
    target = DATA['target']
    points = sorted(DATA['samples'], key=lambda p: ((p['x']-target['x'])**2 + (p['y']-target['y'])**2, p['id']))[:k]
    return {name: sum(p['type'] == kind for p in points) for name, kind in [('金丝猴', 'monkey'), ('雪豹', 'leopard')]}


def tree_summary(value):
    data = tree_data(value)
    if not data:
        return '未填写'
    lines = []
    for animal_id in data['animal_ids']:
        node = data['tree']
        route = []
        while node.get('feature'):
            feature = node['feature']
            yes = feature in ANIMALS[animal_id]['traits']
            route.append(FEATURES[feature]['label'] + ('是' if yes else '否'))
            node = node['yes' if yes else 'no']
        result = ANIMALS.get(node.get('animal'), {}).get('name', '未分类')
        lines.append(ANIMALS[animal_id]['name'] + '：' + ' → '.join(route + [result]))
    return '\n'.join(lines)


def _tree_metrics(node):
    if not isinstance(node, dict) or not node.get('feature'):
        return 0, 0
    ld, lc = _tree_metrics(node.get('yes'))
    rd, rc = _tree_metrics(node.get('no'))
    return 1 + max(ld, rd), 1 + lc + rc


def _tree_compact(node):
    if not isinstance(node, dict):
        return '待分类'
    if node.get('feature'):
        label = FEATURES.get(node['feature'], {}).get('short', node['feature'])
        return f"{label}？[是:{_tree_compact(node.get('yes'))} | 否:{_tree_compact(node.get('no'))}]"
    animal = ANIMALS.get(node.get('animal'))
    return animal['name'] if animal else '待分类'


def _collect_variants(q, records, eligible_ids, students=None):
    if not q.get('decision_tree'):
        return [], Counter(), 0
    stage = q['decision_tree'].get('stage')
    qid = q['id']
    variants = defaultdict(lambda: {'tree': None, 'names': []})
    root_counts = Counter()
    total = 0
    for record in records:
        sid = record['student_id']
        if sid not in eligible_ids:
            continue
        first = json.loads(record['first_answers']) if record.get('first_answers') else {}
        raw = first.get(qid)
        if not raw:
            raw = (record.get('answers') or {}).get(qid)
        data = tree_data(raw)
        if not data or (stage is not None and data.get('animal_ids') != DATA['stages'][stage]):
            continue
        try:
            validate_tree(raw, required=True, stage=stage)
        except ValueError:
            continue
        tree = data['tree']
        sig = json.dumps(tree, sort_keys=True, ensure_ascii=False)
        variants[sig]['tree'] = tree
        name = (students or {}).get(sid, {}).get('name') or str(sid)
        variants[sig]['names'].append(name)
        if tree.get('feature'):
            root_counts[tree['feature']] += 1
        total += 1
    ordered = sorted(variants.values(), key=lambda item: (-len(item['names']), _tree_metrics(item['tree'])))
    return ordered, root_counts, total


def tree_variants(q, records, eligible_ids, students=None):
    """返回可视化决策树方案列表，供教师端学情分析直接绘出各方案树图。"""
    ordered, _, total = _collect_variants(q, records, eligible_ids, students)
    if not total:
        return []
    result = []
    for idx, item in enumerate(ordered, start=1):
        tree = item['tree']
        depth, conds = _tree_metrics(tree)
        count = len(item['names'])
        names = item['names']
        result.append({
            'index': idx,
            'tree': tree,
            'root_label': FEATURES.get(tree.get('feature'), {}).get('label', '—'),
            'depth': depth,
            'conds': conds,
            'count': count,
            'percent': round(count / total * 100),
            'who': '、'.join(names[:6]) + (f' 等 {count} 人' if len(names) > 6 else ''),
        })
    return result


def question_summary(q, records, eligible_ids, students=None):
    """汇总同一道决策树题目的根节点选择分布（具体方案由 tree_variants 图示化）。"""
    ordered, root_counts, total = _collect_variants(q, records, eligible_ids, students)
    if not total:
        return []

    def cell(text, tone=''):
        return {'text': str(text), 'tone': tone}

    root_rows = []
    for fid, count in root_counts.most_common():
        pct = round(count / total * 100)
        root_rows.append([
            cell(FEATURES.get(fid, {}).get('label', fid)),
            cell(f'{count} 人', 'ok'),
            cell(f'{pct}%'),
        ])

    return [
        {
            'title': f'第一层根节点特征选择统计（共 {len(ordered)} 种构造方案 / {total} 人）',
            'headers': ['根节点判断条件', '选择人数', '占比'],
            'rows': root_rows,
        },
    ]


def _valid_coord(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100


def _valid_point(point):
    return (
        isinstance(point, dict)
        and _valid_coord(point.get('x'))
        and _valid_coord(point.get('y'))
        and point.get('type') in ('monkey', 'leopard')
        and isinstance(point.get('id'), str)
        and 0 < len(point['id']) <= 12
    )


def validate_knn_captures(value, required=False):
    if not value and not required:
        return
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        raise ValueError('请先截取 4 只异兽的位置图。') from None
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('异兽位置截图格式不正确。')
    captures = data.get('captures')
    if not isinstance(captures, dict) or any(k not in BEAST_NAMES for k in captures):
        raise ValueError('异兽位置截图仅支持天狗、长右、类、朱厌。')
    for beast, item in captures.items():
        if not isinstance(item, dict):
            raise ValueError(f'{beast}的截图记录格式不正确。')
        target = item.get('target')
        if not isinstance(target, dict) or not _valid_coord(target.get('x')) or not _valid_coord(target.get('y')):
            raise ValueError(f'{beast}的坐标需在 0—100 之间。')
        k = item.get('k')
        if isinstance(k, bool) or k not in (1, 3, 5, 7, 9):
            raise ValueError(f'{beast}的 K 值须为 1、3、5、7 或 9。')
        points = item.get('points')
        if points is not None and (not isinstance(points, list) or len(points) > 30 or not all(_valid_point(p) for p in points)):
            raise ValueError(f'{beast}的样本点位记录不正确。')
    if required and any(name not in captures for name in BEAST_NAMES):
        missing = '、'.join(name for name in BEAST_NAMES if name not in captures)
        raise ValueError(f'还有异兽未截图：{missing}。请集齐 4 张后再提交。')


def knn_captures_data(value):
    """解析 4 只异兽结构化快照，并计算邻居、票数与半径供教师端还原缩略图。"""
    try:
        validate_knn_captures(value)
        data = json.loads(value)
    except (ValueError, TypeError):
        return None
    captures = data.get('captures') or {}
    if not captures:
        return None
    items = []
    for beast in BEAST_NAMES:
        item = captures.get(beast)
        if not item:
            items.append({'beast': beast, 'file': BEAST_FILES[beast], 'captured': False})
            continue
        target = {'x': round(item['target']['x']), 'y': round(item['target']['y'])}
        k = item['k']
        samples = item.get('points') if item.get('points') is not None else DATA['samples']
        ranked = sorted(
            ({**p, 'distance': math.hypot(p['x'] - target['x'], p['y'] - target['y'])} for p in samples),
            key=lambda p: (p['distance'], p['id']),
        )
        neighbors = ranked[:k]
        neighbor_ids = {p['id'] for p in neighbors}
        monkey = sum(1 for p in neighbors if p['type'] == 'monkey')
        leopard = len(neighbors) - monkey
        result = 'tie' if monkey == leopard else ('monkey' if monkey > leopard else 'leopard')
        items.append({
            'beast': beast,
            'file': BEAST_FILES[beast],
            'captured': True,
            'target': target,
            'k': k,
            'samples': samples,
            'neighbors': neighbors,
            'neighbor_ids': neighbor_ids,
            'radius': neighbors[-1]['distance'] if neighbors else 0,
            'monkey': monkey,
            'leopard': leopard,
            'result': result,
            'result_label': RESULT_LABELS[result],
            'sample_count': len(samples),
        })
    return items


def knn_captures_summary(value):
    items = knn_captures_data(value)
    if not items:
        return '未填写'
    lines = []
    for item in items:
        if not item['captured']:
            lines.append(f"{item['beast']}：未截取")
        else:
            t = item['target']
            lines.append(f"{item['beast']}：({t['x']}, {t['y']}) · K={item['k']} · 金丝猴{item['monkey']}票/雪豹{item['leopard']}票 → {item['result_label']}")
    return '\n'.join(lines)
