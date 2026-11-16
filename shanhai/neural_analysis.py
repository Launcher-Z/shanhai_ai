"""第 7 课（7.1 / 7.2）神经网络实验记录的结构化解析与全班汇总。"""
import re
from collections import defaultdict

BINARY_LABELS = {"E01": 0, "E02": 1, "E03": 0, "E04": 1, "E05": 0}
DIGITS_LABELS = {f"E{i:02d}": i - 1 for i in range(1, 11)}

_BASELINE_LINE_RE = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*[：:]\s*(\d)\s*[（(]\s*([\d.]+)%\s*[)）]\s*$")
_MANUAL_LINE_RE = re.compile(
    r"^\s*第(\d+)次\s*[，,]\s*([^，,]+?)\s*[，,]\s*标签\s*(\d)\s*[，,]\s*预测\s*(\d)\s*[（(]\s*([\d.]+)%\s*[)）]\s*[，,]\s*(正确|错误).*?损失\s*([\d.]+)\s*[→>-]+\s*([\d.]+)"
)
_COMPARE_LINE_RE = re.compile(
    r"^\s*([A-Za-z0-9_-]+)\s*[：:]\s*训练\s*0\s*次\s*(.+?)\s*[→>-]+\s*训练\s*(\d+)\s*次\s*(.+?)\s*$"
)
_PRED_PART_RE = re.compile(r"^(\d)\s*[（(]\s*([\d.]+)%\s*[)）]$")


def _cell(text, tone=""):
    return {"text": str(text), "tone": tone}


def _pct(num, total):
    return f"{round(num / total * 100)}%" if total else "—"


def _avg(values, suffix="%"):
    return f"{sum(values) / len(values):.1f}{suffix}" if values else "—"


def _kv_map(value):
    pairs = {}
    for line in str(value or "").splitlines():
        if "：" in line:
            k, v = line.split("：", 1)
            pairs[k.strip()] = v.strip()
        elif ":" in line:
            k, v = line.split(":", 1)
            pairs[k.strip()] = v.strip()
    return pairs


def _to_int(text):
    try:
        return int(str(text).strip())
    except (TypeError, ValueError):
        return None


def _to_float(text):
    try:
        return float(str(text).strip())
    except (TypeError, ValueError):
        return None


def parse_baseline_rows(value, label_map):
    rows = []
    for line in str(value or "").splitlines():
        m = _BASELINE_LINE_RE.match(line)
        if not m:
            continue
        sid, pred, prob = m.group(1).strip(), int(m.group(2)), float(m.group(3))
        truth = label_map.get(sid)
        correct = (pred == truth) if truth is not None else None
        rows.append({
            "id": sid, "label": truth, "pred": pred, "prob": prob, "correct": correct,
        })
    return rows


def parse_manual_rows(value):
    kv = _kv_map(value)
    if any(k.startswith("第") and "·" in k for k in kv):
        rows = []
        for step in (1, 2, 3):
            prefix = f"第{step}次·"
            label = _to_int(kv.get(f"{prefix}正确标签"))
            pred = _to_int(kv.get(f"{prefix}模型预测"))
            prob = _to_float(kv.get(f"{prefix}预测比例（%）"))
            verdict = kv.get(f"{prefix}对错", "")
            loss_before = _to_float(kv.get(f"{prefix}更新前损失"))
            loss_after = _to_float(kv.get(f"{prefix}更新后损失"))
            if label is None and pred is None and prob is None and not verdict and loss_before is None and loss_after is None:
                continue
            rows.append({
                "step": step,
                "sample": f"第{step}次样本",
                "label": label if label is not None else "—",
                "pred": pred if pred is not None else "—",
                "prob": prob,
                "correct": verdict == "正确" if verdict in ("正确", "错误") else None,
                "loss_before": loss_before,
                "loss_after": loss_after,
            })
        return rows
    rows = []
    for line in str(value or "").splitlines():
        m = _MANUAL_LINE_RE.match(line)
        if not m:
            continue
        rows.append({
            "step": int(m.group(1)),
            "sample": m.group(2).strip(),
            "label": int(m.group(3)),
            "pred": int(m.group(4)),
            "prob": float(m.group(5)),
            "correct": m.group(6) == "正确",
            "loss_before": float(m.group(7)),
            "loss_after": float(m.group(8)),
        })
    return rows


def parse_binary_comparison(value):
    rows = []
    for line in str(value or "").splitlines():
        m = _COMPARE_LINE_RE.match(line)
        if not m:
            continue
        sid = m.group(1).strip()
        truth = BINARY_LABELS.get(sid)
        bm = _PRED_PART_RE.match(m.group(2).strip())
        a_steps = int(m.group(3))
        am = _PRED_PART_RE.match(m.group(4).strip())
        if not bm and not am:
            continue
        b_pred = int(bm.group(1)) if bm else None
        b_prob = float(bm.group(2)) if bm else None
        a_pred = int(am.group(1)) if am else None
        a_prob = float(am.group(2)) if am else None
        rows.append({
            "id": sid, "label": truth,
            "before_pred": b_pred, "before_prob": b_prob,
            "before_correct": (b_pred == truth) if (b_pred is not None and truth is not None) else None,
            "after_steps": a_steps, "after_pred": a_pred, "after_prob": a_prob,
            "after_correct": (a_pred == truth) if (a_pred is not None and truth is not None) else None,
        })
    return rows


def parse_ten_comparison(value):
    kv = _kv_map(value)
    digits = [_to_int(kv.get(f"第{i}列数字")) for i in range(1, 6)]
    if not any(d is not None for d in digits):
        return None
    custom_steps = _to_int(kv.get("自选累计次数"))
    stages = []
    for key, label in (("0", "0次"), ("101", "101次"), ("401", "401次"), ("custom", f"自选({custom_steps}次)" if custom_steps is not None else "自选次数")):
        prefix = "自选次" if key == "custom" else f"{key}次"
        cells = []
        for idx in range(1, 6):
            verdict = kv.get(f"{prefix}·图片{idx}对错", "")
            prob = _to_float(kv.get(f"{prefix}·图片{idx}比例（%）"))
            cells.append({
                "digit": digits[idx - 1],
                "correct": True if verdict == "正确" else (False if verdict == "错误" else None),
                "prob": prob,
            })
        stages.append({"key": key, "label": label, "cells": cells})
    return {"digits": digits, "custom_steps": custom_steps, "stages": stages}


def parse_handwriting_records(value):
    kv = _kv_map(value)
    items = []
    for i in range(1, 4):
        sid = _to_int(kv.get(f"记录{i}·手写编号"))
        actual = _to_int(kv.get(f"记录{i}·实际数字"))
        steps = _to_int(kv.get(f"记录{i}·累计训练次数"))
        d1 = _to_int(kv.get(f"记录{i}·第一预测数字"))
        p1 = _to_float(kv.get(f"记录{i}·第一预测比例（%）"))
        d2 = _to_int(kv.get(f"记录{i}·第二预测数字"))
        p2 = _to_float(kv.get(f"记录{i}·第二预测比例（%）"))
        if sid is None and actual is None and d1 is None:
            continue
        items.append({
            "slot": i, "source_id": sid, "actual": actual, "steps": steps,
            "first_digit": d1, "first_prob": p1,
            "second_digit": d2, "second_prob": p2,
            "first_hit": (actual is not None and d1 == actual),
            "top2_hit": (actual is not None and (d1 == actual or d2 == actual)),
        })
    return items


def structured_answer(value, q):
    """把实验文字记录转为教师工作台可直接渲染的数据表。"""
    if not value or not isinstance(q, dict):
        return None
    if q.get('record_table', {}).get('kind') == 'animal_predictions':
        values = _kv_map(value)
        sources = [f'图{i}' for i in range(1, 10)]
        if any(field['key'] == 'camera-class-1' for field in q['record_table']['fields']):
            sources.append('摄像头')
        return {'headers': ['来源', values.get('类别1名称') or '类别1', values.get('类别2名称') or '类别2'],
                'rows': [[_cell(name)] + [_cell(values.get(f'{name}·类别{c}', '') + '%'
                          if values.get(f'{name}·类别{c}', '') else '—') for c in (1, 2)] for name in sources]}
    qid = q.get("id")
    if qid in {"baseline-record", "ten-baseline"}:
        label_map = BINARY_LABELS if qid == "baseline-record" else DIGITS_LABELS
        parsed = parse_baseline_rows(value, label_map)
        if not parsed:
            return None
        rows = []
        for r in parsed:
            verdict = "正确" if r["correct"] else ("错误" if r["correct"] is False else "—")
            tone = "ok" if r["correct"] else ("bad" if r["correct"] is False else "")
            rows.append([
                _cell(r["id"]),
                _cell(r["label"] if r["label"] is not None else "—"),
                _cell(r["pred"]),
                _cell(f"{r['prob']:.1f}%"),
                _cell(verdict, tone),
            ])
        return {"headers": ["测试图", "真实数字", "模型预测", "置信比例", "判断"], "rows": rows}

    if qid == "manual-record":
        parsed = parse_manual_rows(value)
        if not parsed:
            return None
        has_loss = any(r["loss_before"] is not None or r["loss_after"] is not None for r in parsed)
        rows = []
        for r in parsed:
            prob_text = f"（{r['prob']:.1f}%）" if r["prob"] is not None else ""
            verdict_text = "正确" if r["correct"] else ("错误" if r["correct"] is False else "—")
            verdict_tone = "ok" if r["correct"] else ("bad" if r["correct"] is False else "muted")
            row = [
                _cell(f"第{r['step']}次"),
                _cell(r["label"]),
                _cell(f"{r['pred']}{prob_text}"),
                _cell(verdict_text, verdict_tone),
            ]
            if has_loss:
                lb, la = r["loss_before"], r["loss_after"]
                diff = (la - lb) if (lb is not None and la is not None) else None
                loss_text = f"{lb:.2f} → {la:.2f}" if diff is not None else "—"
                row.append(_cell(loss_text, "up" if (diff is not None and diff < 0) else ""))
            rows.append(row)
        headers = ["次序", "标签", "预测（比例）", "对错"] + (["损失变化"] if has_loss else [])
        return {"headers": headers, "rows": rows}

    if qid == "binary-comparison":
        parsed = parse_binary_comparison(value)
        if not parsed:
            return None
        rows = []
        for r in parsed:
            b_cell = (
                _cell(f"{r['before_pred']}（{r['before_prob']:.1f}% · {'对' if r['before_correct'] else '错'}）", "ok" if r["before_correct"] else "bad")
                if r["before_pred"] is not None else _cell("未测试", "muted")
            )
            a_cell = (
                _cell(f"{r['after_pred']}（{r['after_prob']:.1f}% · {'对' if r['after_correct'] else '错'}）", "ok" if r["after_correct"] else "bad")
                if r["after_pred"] is not None else _cell("未测试", "muted")
            )
            if r["before_prob"] is not None and r["after_prob"] is not None:
                delta = r["after_prob"] - r["before_prob"]
                a_tag = "对" if r["after_correct"] else "错"
                turned = not r["before_correct"] and r["after_correct"]
                delta_cell = _cell(f"{'转对' if turned else a_tag}（{delta:+.1f}%）", "up" if turned else ("ok" if r["after_correct"] else "bad"))
            else:
                delta_cell = _cell("—", "muted")
            rows.append([
                _cell(r["id"]),
                _cell(r["label"] if r["label"] is not None else "—"),
                b_cell,
                a_cell,
                delta_cell,
            ])
        return {"headers": ["测试图", "真实", "训练0次", f"训练{parsed[0]['after_steps']}次", "变化"], "rows": rows}

    if qid == "ten-comparison":
        parsed = parse_ten_comparison(value)
        if not parsed:
            return None
        headers = ["阶段"] + [f"图{i}（{d if d is not None else '未选'}）" for i, d in enumerate(parsed["digits"], 1)]
        rows = []
        for st in parsed["stages"]:
            row = [_cell(st["label"])]
            for c in st["cells"]:
                if c["correct"] is None and c["prob"] is None:
                    row.append(_cell("—", "muted"))
                else:
                    flag = "✓" if c["correct"] else ("✕" if c["correct"] is False else "")
                    prob = f" {c['prob']:.1f}%" if c["prob"] is not None else ""
                    row.append(_cell(f"{flag}{prob}".strip(), "ok" if c["correct"] else ("bad" if c["correct"] is False else "")))
            rows.append(row)
        return {"headers": headers, "rows": rows}

    if qid == "handwriting-record":
        parsed = parse_handwriting_records(value)
        if not parsed:
            return None
        ctx = q.get("handwriting_context") if isinstance(q.get("handwriting_context"), dict) else {}
        rows = []
        for item in parsed:
            p1 = f"{item['first_digit']}（{item['first_prob']:.1f}%）" if item["first_digit"] is not None else "—"
            p2 = f"{item['second_digit']}（{item['second_prob']:.1f}%）" if item["second_digit"] is not None else "—"
            if item["first_hit"]:
                hit_cell = _cell("首位命中", "ok")
            elif item["top2_hit"]:
                hit_cell = _cell("第二候选命中", "up")
            else:
                hit_cell = _cell("未命中", "bad")
            slot_ctx = ctx.get(str(item["slot"]))
            bits = slot_ctx.get("pixels") if isinstance(slot_ctx, dict) else ""
            if isinstance(bits, str) and len(bits) == 216 and set(bits) <= {"0", "1"}:
                actual_label = item["actual"] if item["actual"] is not None else "未填"
                digit_cell = {"text": "", "tone": "", "bits": bits, "alt": f"记录{item['slot']}手写数字（实际 {actual_label}）"}
            else:
                digit_cell = _cell("无图", "muted")
            rows.append([
                _cell(f"记录{item['slot']}（#{item['source_id']}）" if item["source_id"] is not None else f"记录{item['slot']}"),
                digit_cell,
                _cell(item["actual"] if item["actual"] is not None else "—"),
                _cell(f"{item['steps']}次" if item["steps"] is not None else "—"),
                _cell(p1, "ok" if item["first_hit"] else ""),
                _cell(p2),
                hit_cell,
            ])
        return {"headers": ["尝试", "手写数字", "实际数字", "累计训练", "第一预测", "第二预测", "识别结果"], "rows": rows}

    return None


def question_summary(q, records, eligible_ids):
    """为 7.1 / 7.2 特定实验题生成全班数据汇总表列表。"""
    qid = q.get("id")
    if qid not in {"baseline-record", "manual-record", "binary-comparison",
                   "ten-baseline", "ten-comparison", "handwriting-record"}:
        return None

    values = [r["answers"].get(qid) for r in records
              if r["student_id"] in eligible_ids and r["answers"].get(qid)]
    if not values:
        return None

    if qid in {"baseline-record", "ten-baseline"}:
        label_map = BINARY_LABELS if qid == "baseline-record" else DIGITS_LABELS
        bucket = defaultdict(list)
        submitters = 0
        for val in values:
            parsed = parse_baseline_rows(val, label_map)
            if parsed:
                submitters += 1
                for item in parsed:
                    bucket[item["id"]].append(item)
        if not submitters:
            return None
        order = list(label_map.keys())
        keys = [k for k in order if k in bucket] + [k for k in bucket if k not in order]
        rows = []
        for sid in keys:
            items = bucket[sid]
            ok = sum(1 for x in items if x["correct"])
            truth = label_map.get(sid)
            rows.append([
                _cell(sid),
                _cell(truth if truth is not None else "—"),
                _cell(f"{len(items)} 人"),
                _cell(f"{ok}/{len(items)}（{_pct(ok, len(items))}）", "ok" if ok * 2 >= len(items) else "bad"),
                _cell(_avg([x["prob"] for x in items])),
            ])
        return [{
            "title": f"全班初测汇总（已带入 {submitters} 人）",
            "headers": ["测试图", "真实数字", "测试人次", "正确人数 / 率", "平均预测比例"],
            "rows": rows,
        }]

    if qid == "manual-record":
        by_step = defaultdict(list)
        submitters = 0
        for val in values:
            parsed = parse_manual_rows(val)
            if parsed:
                submitters += 1
                for item in parsed:
                    by_step[item["step"]].append(item)
        if not submitters:
            return None
        has_loss = any(
            x["loss_before"] is not None and x["loss_after"] is not None
            for items in by_step.values() for x in items
        )
        rows = []
        for step in sorted(by_step):
            items = by_step[step]
            judged = [x for x in items if x["correct"] is not None]
            ok = sum(1 for x in judged if x["correct"])
            row = [
                _cell(f"第{step}次"),
                _cell(f"{len(items)} 人"),
                _cell(f"{ok}/{len(judged)}（{_pct(ok, len(judged))}）" if judged else "—", "ok" if judged and ok * 2 >= len(judged) else ""),
                _cell(_avg([x["prob"] for x in items if x["prob"] is not None])),
            ]
            if has_loss:
                loss_pairs = [x for x in items if x["loss_before"] is not None and x["loss_after"] is not None]
                dropped = sum(1 for x in loss_pairs if x["loss_after"] < x["loss_before"])
                b_avg = _avg([x["loss_before"] for x in loss_pairs], "")
                a_avg = _avg([x["loss_after"] for x in loss_pairs], "")
                row.append(_cell(f"{b_avg} → {a_avg}", "up"))
                row.append(_cell(f"{dropped}/{len(loss_pairs)}（{_pct(dropped, len(loss_pairs))}）" if loss_pairs else "—", "ok" if loss_pairs and dropped == len(loss_pairs) else ""))
            rows.append(row)
        headers = ["训练步", "记录人数", "预测正确率", "平均预测比例"] + (["平均损失前 → 后", "损失下降人数"] if has_loss else [])
        return [{
            "title": f"全班逐次训练汇总（已记录 {submitters} 人）",
            "headers": headers,
            "rows": rows,
        }]

    if qid == "binary-comparison":
        bucket = defaultdict(list)
        submitters = 0
        for val in values:
            parsed = parse_binary_comparison(val)
            if parsed:
                submitters += 1
                for item in parsed:
                    bucket[item["id"]].append(item)
        if not submitters:
            return None
        rows = []
        for sid in [k for k in BINARY_LABELS if k in bucket]:
            items = bucket[sid]
            b_items = [x for x in items if x["before_prob"] is not None]
            a_items = [x for x in items if x["after_prob"] is not None]
            b_ok = sum(1 for x in b_items if x["before_correct"])
            a_ok = sum(1 for x in a_items if x["after_correct"])
            flipped = sum(1 for x in items if x["before_correct"] is False and x["after_correct"])
            rows.append([
                _cell(sid),
                _cell(BINARY_LABELS[sid]),
                _cell(f"{_pct(b_ok, len(b_items))}（均 {_avg([x['before_prob'] for x in b_items])}）" if b_items else "未测试", "muted" if not b_items else ""),
                _cell(f"{_pct(a_ok, len(a_items))}（均 {_avg([x['after_prob'] for x in a_items])}）" if a_items else "未测试", "ok" if a_ok > b_ok else ("muted" if not a_items else "")),
                _cell(f"{flipped} 人", "up" if flipped else ""),
            ])
        return [{
            "title": f"全班训练前后对比汇总（已提交 {submitters} 人）",
            "headers": ["测试图", "真实", "训练0次（正确率 / 均比）", "训练后（正确率 / 均比）", "由错转对"],
            "rows": rows,
        }]

    if qid == "ten-comparison":
        stage_bucket = defaultdict(list)
        digit_stage_bucket = defaultdict(lambda: defaultdict(list))
        submitters = 0
        for val in values:
            parsed = parse_ten_comparison(val)
            if not parsed:
                continue
            submitters += 1
            for st in parsed["stages"]:
                for cell in st["cells"]:
                    if cell["correct"] is None and cell["prob"] is None:
                        continue
                    stage_bucket[st["key"]].append(cell)
                    if cell["digit"] is not None:
                        digit_stage_bucket[cell["digit"]][st["key"]].append(cell)
        if not submitters:
            return None
        stage_meta = [("0", "0次"), ("101", "101次"), ("401", "401次"), ("custom", "自选次数")]
        trend_rows = []
        for key, label in stage_meta:
            cells = stage_bucket[key]
            judged = [c for c in cells if c["correct"] is not None]
            ok = sum(1 for c in judged if c["correct"])
            probs = [c["prob"] for c in cells if c["prob"] is not None]
            trend_rows.append([
                _cell(label),
                _cell(f"{len(cells)} 格"),
                _cell(f"{ok}/{len(judged)}（{_pct(ok, len(judged))}）", "ok" if judged and ok * 2 >= len(judged) else ""),
                _cell(_avg(probs)),
            ])
        digit_rows = []
        for digit in sorted(digit_stage_bucket):
            row = [_cell(f"数字 {digit}")]
            total_cells = sum(len(v) for v in digit_stage_bucket[digit].values())
            row.append(_cell(f"{total_cells} 格"))
            for key, _ in stage_meta:
                judged = [c for c in digit_stage_bucket[digit][key] if c["correct"] is not None]
                ok = sum(1 for c in judged if c["correct"])
                row.append(_cell(_pct(ok, len(judged)) if judged else "—"))
            digit_rows.append(row)
        tables = [{
            "title": f"全班各训练阶段走势汇总（已填 {submitters} 人）",
            "headers": ["训练阶段", "有效测试格", "总体正确率", "平均预测比例"],
            "rows": trend_rows,
        }]
        if digit_rows:
            tables.append({
                "title": "各数字（0—9）在各阶段的正确率分布",
                "headers": ["测试数字", "总记录数", "0次", "101次", "401次", "自选次数"],
                "rows": digit_rows,
            })
        return tables

    if qid == "handwriting-record":
        by_digit = defaultdict(list)
        submitters = 0
        total_records = 0
        for val in values:
            items = parse_handwriting_records(val)
            if not items:
                continue
            submitters += 1
            for item in items:
                if item["actual"] is None:
                    continue
                total_records += 1
                by_digit[item["actual"]].append(item)
        if not total_records:
            return None
        rows = []
        for digit in sorted(by_digit):
            items = by_digit[digit]
            top1 = sum(1 for x in items if x["first_hit"])
            top2 = sum(1 for x in items if x["top2_hit"])
            first_probs = [x["first_prob"] for x in items if x["first_prob"] is not None]
            second_probs = [x["second_prob"] for x in items if x["second_prob"] is not None]
            rows.append([
                _cell(f"数字 {digit}"),
                _cell(f"{len(items)} 条"),
                _cell(f"{top1}/{len(items)}（{_pct(top1, len(items))}）", "ok" if top1 * 2 >= len(items) else "bad"),
                _cell(_avg(first_probs)),
                _cell(f"{top2}/{len(items)}（{_pct(top2, len(items))}）"),
                _cell(_avg(second_probs)),
            ])
        return [{
            "title": f"全班手写识别表现汇总（已交 {submitters} 人，共 {total_records} 条有效尝试）",
            "headers": ["数字标签", "尝试条数", "第一预测命中", "第一预测平均概率", "前二预测覆盖", "第二预测平均概率"],
            "rows": rows,
        }]
    return None
