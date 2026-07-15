"""Generate JS fixture blocks for frame_fixtures.js from exam tasks JSON."""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from frame_solver import parse_task, solve_frame, sign_pattern

SKIP = {'hs2020_fragec1', 'hs2020_fraged1', 'hs2022_frageb3', 'fs2020_fraged1'}

SUPPORT_MAP = {'fixed': 'fixed', 'pin': 'pin', 'roller_y': 'roller', 'roller_x': 'roller'}

with open('/Users/lucaskoll/Documents/New project/schnittkraft_trainer/data/tasks/tragwerke_from_exams.json') as f:
    tasks = json.load(f)

MARGIN = 1.0

for task in tasks:
    tid = task['task_id']
    if tid in SKIP:
        continue

    # coordinate bounds (JSON y-up)
    xs = [n['x'] for n in task['nodes']]
    ys = [n['y'] for n in task['nodes']]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    # avoid zero dimensions
    if xmax == xmin: xmax = xmin + 1
    if ymax == ymin: ymax = ymin + 1

    def cx(x): return round((x - xmin) + MARGIN, 3)
    def cy(y): return round((ymax - y) + MARGIN, 3)  # flip for canvas y-down

    bbox_w = round((xmax - xmin) + 2 * MARGIN, 3)
    bbox_h = round((ymax - ymin) + 2 * MARGIN, 3)

    # nodes dict
    nodes_js = {}
    for n in task['nodes']:
        nodes_js[n['node_id']] = {'x': cx(n['x']), 'y': cy(n['y'])}

    # bars
    bars_js = []
    for m in task['members']:
        bar_id = f"{m['start_node']}{m['end_node']}"
        bars_js.append({'id': bar_id, 'from': m['start_node'], 'to': m['end_node']})

    # supports
    support_node_ids = {s['node_id'] for s in task['supports']}
    supports_js = {}
    for s in task['supports']:
        supports_js[s['node_id']] = SUPPORT_MAP.get(s['support_type'], 'pin')

    # welds: nodes that are inner (not supports, connected to 2+ members)
    node_member_count = {}
    for m in task['members']:
        for nid in [m['start_node'], m['end_node']]:
            node_member_count[nid] = node_member_count.get(nid, 0) + 1
    welds = [nid for nid, cnt in node_member_count.items()
             if cnt >= 2 and nid not in support_node_ids]

    # free ends: nodes with 1 member connection and not a support
    free_ends = [nid for nid, cnt in node_member_count.items()
                 if cnt == 1 and nid not in support_node_ids]

    # loads
    loads_js = []
    dist_bars = []
    for load in task['loads']:
        ltype = load.get('type')
        if ltype == 'point_force':
            fx_raw = load.get('fx', 0)
            fy_raw = load.get('fy', 0)
            def to_num(v):
                if isinstance(v, (int, float)): return float(v)
                s = str(v).strip()
                if not s or s == '0': return 0.0
                return -1.0 if s.startswith('-') else 1.0
            fx = to_num(fx_raw)
            fy = to_num(fy_raw)
            label = load.get('label', 'F')
            if fx != 0 or fy != 0:
                loads_js.append({'kind': 'point', 'node': load['node_id'],
                                  'fx': fx, 'fy': fy, 'label': label})
        elif ltype == 'distributed':
            # find bar id
            mid_num = load['member_id']
            for m in task['members']:
                if m['member_id'] == mid_num:
                    bar_id = f"{m['start_node']}{m['end_node']}"
                    break
            loads_js.append({'kind': 'distributed', 'bar': bar_id, 'q': 1, 'label': 'q'})
            dist_bars.append(bar_id)

    # solve for solutions
    nodes_s, members_s, supports_s, point_loads_s, dist_loads_s = parse_task(task)
    try:
        res, _ = solve_frame(nodes_s, members_s, supports_s, point_loads_s, dist_loads_s)
        solutions = {'N': {}, 'Q': {}, 'M': {}}
        for m in task['members']:
            bar_id = f"{m['start_node']}{m['end_node']}"
            r = res[m['member_id']]
            solutions['N'][bar_id] = sign_pattern(r['N_start'], r['N_end'])
            solutions['Q'][bar_id] = sign_pattern(r['Q_start'], r['Q_end'])
            solutions['M'][bar_id] = sign_pattern(r['M_start'], r['M_end'])
    except Exception as e:
        print(f"// ERROR solving {tid}: {e}")
        continue

    source = f"{task['source_pdf'].replace('.pdf','')} – {task['source_task_label']}"

    # emit JS
    print(f"  // {'='*60}")
    print(f"  // {source}: {task['title']}")
    print(f"  // {'='*60}")
    print(f"  {{")
    print(f"    id: '{tid}',")
    print(f"    title: '{task['title'].replace(chr(39), chr(96))}',")
    print(f"    description: '{task['notes'].replace(chr(39), chr(96))}',")
    print(f"    source: '{source}',")
    print(f"    bbox: {{ w: {bbox_w}, h: {bbox_h} }},")
    # nodes
    nodes_str = ', '.join(f"{k}: {{ x: {v['x']}, y: {v['y']} }}" for k,v in nodes_js.items())
    print(f"    nodes: {{ {nodes_str} }},")
    # bars
    bars_str = ', '.join(f"{{ id: '{b['id']}', from: '{b['from']}', to: '{b['to']}'" +
                         (", distributed: true" if b['id'] in dist_bars else "") + " }"
                         for b in bars_js)
    print(f"    bars: [ {bars_str} ],")
    # supports
    sup_str = ', '.join(f"{k}: '{v}'" for k,v in supports_js.items())
    print(f"    supports: {{ {sup_str} }},")
    if welds:
        print(f"    welds: {json.dumps(welds)},")
    if free_ends:
        print(f"    freeEnds: {json.dumps(free_ends)},")
    # loads
    def load_to_js(l):
        if l['kind'] == 'point':
            return f"{{ kind: 'point', node: '{l['node']}', fx: {l['fx']}, fy: {l['fy']}, label: '{l['label']}' }}"
        else:
            return f"{{ kind: 'distributed', bar: '{l['bar']}', q: {l['q']}, label: '{l['label']}' }}"
    loads_str = ', '.join(load_to_js(l) for l in loads_js)
    print(f"    loads: [ {loads_str} ],")
    # solutions
    def sol_obj(d):
        return '{ ' + ', '.join(f"{k}: '{v}'" for k,v in d.items()) + ' }'
    print(f"    solutions: {{")
    print(f"      N: {sol_obj(solutions['N'])},")
    print(f"      Q: {sol_obj(solutions['Q'])},")
    print(f"      M: {sol_obj(solutions['M'])},")
    print(f"    }},")
    if dist_bars:
        print(f"    parabolicBars: {{ M: {json.dumps(dist_bars)} }},")
    print(f"  }},")
    print()
