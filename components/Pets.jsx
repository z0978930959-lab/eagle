'use client';
// 寵物欄位　路徑：foshan/components/Pets.jsx
import { PETS, COLORS, colorOf, colorRank, petLabel, PITY_N } from '@/lib/nowhere';

export default function Pets({ S, patch }) {
  const list = S.pets || [];
  const equipped = S.petEquip || null;

  const sorted = [...list].sort((a, b) => {
    const t = PETS[b.pid].tier - PETS[a.pid].tier;
    if (t) return t;
    return colorRank(b.color) - colorRank(a.color);
  });

  const equip = uid => patch({ petEquip: uid === equipped ? null : uid });
  const release = uid => patch(p => ({
    pets: (p.pets || []).filter(x => x.uid !== uid),
    petEquip: p.petEquip === uid ? null : p.petEquip,
  }));

  const cur = list.find(p => p.uid === equipped);

  return (
    <>
      <div className="card">
        <p className="h2">寵物</p>
        <p className="muted" style={{ marginTop:-8, marginBottom:14 }}>
          同時只能帶一隻。茄子、石板、茉莉兒只有機制效果，顏色不影響數值；
          只有寶貝英雄的傷害加成會隨顏色浮動，打 BOSS 時減半。
        </p>
        <table className="kv">
          <tbody>
            <tr><td>目前出戰</td><td>{cur ? petLabel(cur) : '沒有帶寵物'}</td></tr>
            <tr><td>擁有數量</td><td>{list.length}</td></tr>
            <tr><td>兌換保底</td><td>{(S.petPity || 0)} / {PITY_N}　（累積未出紅或彩的次數）</td></tr>
          </tbody>
        </table>
        <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
          {COLORS.map(c => (
            <span key={c.id} className="mono"
              style={{ fontSize:11, padding:'2px 8px', borderRadius:6,
                       border:`1px solid ${c.hex}`, color:c.hex }}>
              {c.name}　{(c.rate*100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <p className="h2">持有</p>
        {sorted.length === 0
          ? <p className="muted">還沒有任何寵物。無處鎮的三個任務各會給一隻。</p>
          : (
            <div className="grid2">
              {sorted.map(inst => {
                const p = PETS[inst.pid]; const c = colorOf(inst.color);
                const on = inst.uid === equipped;
                return (
                  <div key={inst.uid} className="card"
                    style={{ borderColor: on ? 'var(--brass)' : c.hex, padding:12 }}>
                    <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                      <img src={p.img} alt="" style={{ width:52, height:52, objectFit:'contain', borderRadius:8 }}
                           onError={e=>{e.target.style.opacity=.2;}} />
                      <div style={{ flex:1 }}>
                        <b style={{ color:c.hex }}>{c.name}·{p.name}</b>
                        <p className="muted" style={{ fontSize:11 }}>T{p.tier}{on ? '　· 出戰中' : ''}</p>
                      </div>
                    </div>
                    <p className="muted" style={{ fontSize:12, marginTop:8, lineHeight:1.7 }}>{p.desc}</p>
                    {inst.dmg != null && (
                      <p style={{ marginTop:6, color:'var(--brass)' }}>
                        傷害 +{(inst.dmg*100).toFixed(1)}%
                        <span className="muted" style={{ fontSize:11 }}>
                          　（BOSS +{(inst.dmg*50).toFixed(1)}%）
                        </span>
                      </p>
                    )}
                    <div style={{ display:'flex', gap:8, marginTop:10 }}>
                      <button className={`btn${on ? '' : ' key'}`} onClick={()=>equip(inst.uid)}>
                        {on ? '收回' : '出戰'}
                      </button>
                      <button className="btn" onClick={()=>release(inst.uid)}>放生</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </>
  );
}
