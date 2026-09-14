'use client';
import { TREE, TREE_ZONES } from '@/lib/data';
import { apLeft, apTotal, apSpent, nodeOpen, zones, period, BASE_PERIOD } from '@/lib/engine';



// 全樹 id → 名稱對照，用來把「前置節點」講清楚是哪一個
const NODE_NAME = Object.fromEntries(
  Object.values(TREE).flat().map(n => [n.id, n.name])
);

export default function Tree({ S, patch }) {
  const left = apLeft(S);
  const Z = zones(S.tree);
  const P = period(S.tree);

  function add(node) {
    const cur = S.tree[node.id] || 0;
    if (left <= 0 || cur >= node.max || !nodeOpen(node, S.tree)) return;
    patch(p => ({ tree: { ...p.tree, [node.id]: cur + 1 } }));
  }

  return (
    <>
      <div className="card">
        <p className="h2">能力樹</p>
        <table className="kv">
          <tbody>
            <tr><td>可用點數</td><td style={{ color: left > 0 ? 'var(--brass)' : undefined }}>{left}</td></tr>
            <tr><td>已投入 / 總獲得</td><td>{apSpent(S.tree)} / {apTotal(S.lv)}</td></tr>
            <tr><td>天賦樹總量</td><td>357 點（LV120 點滿）</td></tr>
            <tr><td>指針週期</td><td>{P} ms（基礎 {BASE_PERIOD}）</td></tr>
            <tr><td>判定格數</td><td>中心 {Z.center}　最佳 {Z.best}　次佳 {Z.good}　普通 {Z.normal}　MISS {Z.miss}</td></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 12 }}>
          忘卻藥水可在商店購入，使用後全部重置。加點順序不影響最終結果。
        </p>
      </div>

      {Object.entries(TREE).map(([zone, nodes]) => (
        <div className="card" key={zone}>
          <p className="h2">{TREE_ZONES[zone].name}</p>
          <p className="muted" style={{marginTop:-8,marginBottom:14}}>{TREE_ZONES[zone].desc}</p>
          <div className="grid2">
            {nodes.map(n => {
              const cur = S.tree[n.id] || 0;
              const open = nodeOpen(n, S.tree);
              const full = cur >= n.max;
              return (
                <button
                  key={n.id}
                  className="node"
                  disabled={!open || full || left <= 0}
                  onClick={() => add(n)}
                >
                  <div className="top">
                    <b>{n.name}</b>
                    <span className="lvl">{cur} / {n.max}</span>
                  </div>
                  <p>{n.desc}</p>
                  {!open && (
                    <p style={{ color: 'var(--vermilion)' }}>
                      需先將「{NODE_NAME[n.need[0]] || n.need[0]}」點到 {n.need[1]} 級
                      （目前 {S.tree[n.need[0]] || 0} / {n.need[1]}）
                    </p>
                  )}
                  <div className="pips">
                    {Array.from({ length: n.max }).map((_, i) =>
                      <span key={i} className={`pip ${i < cur ? 'f' : ''}`} />)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
