import React, { useEffect, useState } from "react";
import { api } from "../services/api";

export default function MediaManager({ assets, onChange }) {
  const [purpose, setPurpose] = useState("product");
  const [targetId, setTargetId] = useState("");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [banners, setBanners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([api.admin.products(), api.admin.metadata(), api.admin.banners()]).then(([p, m, b]) => {
      if (active) { setProducts(p.products); setCategories(m.categories); setBanners(b.banners); }
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  const destinations = purpose === "product" ? products : purpose === "category" ? categories : banners;
  const upload = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.get("targetId")) data.delete("targetId");
    if (!data.get("optionId")) data.delete("optionId");
    data.set("primary", form.elements.primary?.checked ? "true" : "false");
    setBusy(true); setMessage("");
    try { await api.admin.uploadImage(data); setMessage("Imagem enviada e vinculada."); onChange(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const edit = async (id, body) => {
    setBusy(true); setMessage("");
    try { await api.admin.updateImage(id, body); onChange(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <div className="media-manager">
    <form onSubmit={upload} className="media-upload">
      <h2>Imagens da loja</h2>
      <p>JPEG, PNG ou WebP, até 5 MB. Substituições preservam arquivos antigos.</p>
      <label>Destino<select name="purpose" value={purpose} onChange={event => { setPurpose(event.target.value); setTargetId(""); }}>
        <option value="product">Produto</option><option value="category">Categoria</option>
        <option value="banner">Banner</option><option value="favicon">Ícone da loja</option><option value="library">Biblioteca</option>
      </select></label>
      {["product", "category", "banner"].includes(purpose) && <label>Selecione<select name="targetId" value={targetId} required={purpose !== "banner"} onChange={event => setTargetId(event.target.value)}>
        <option value="">{purpose === "banner" ? "Criar novo banner" : "Selecione"}</option>
        {destinations.map(item => <option key={item.id} value={item.id}>{item.name ?? item.title}</option>)}
      </select></label>}
      {purpose === "product" && targetId && <label>Cor ou estampa (opcional)<select name="optionId">
        <option value="">Galeria geral do produto</option>
        {products.find(product => product.id === targetId)?.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>}
      <label>Descrição<input name="altText" maxLength={255} /></label>
      <label>Ordem<input name="sortOrder" type="number" min="0" max="999" defaultValue="0" /></label>
      {purpose === "product" && <label><input name="primary" type="checkbox" /> Usar como capa</label>}
      <label>Arquivo<input name="file" type="file" required accept="image/jpeg,image/png,image/webp" /></label>
      <button className="button" disabled={busy}>Enviar imagem</button>
      {message && <p role="status">{message}</p>}
    </form>
    <div className="media-grid">{assets.map(asset => <article key={asset.id}>
      <img src={asset.url} alt={asset.altText ?? "Imagem da loja"} loading="lazy" />
      <p>{asset.altText || asset.purpose}</p>
      {asset.productImages?.map(image => <div key={image.id}>
        <small>{image.product.name}</small>
        <button className="button outline" disabled={busy || image.type === "PRIMARY"} onClick={() => edit(image.id, { primary: true })}>{image.type === "PRIMARY" ? "Capa atual" : "Usar como capa"}</button>
        <label>Ordem<input type="number" min="0" max="999" defaultValue={image.sortOrder} disabled={busy} onBlur={event => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value >= 0 && value <= 999 && value !== image.sortOrder) edit(image.id, { sortOrder: value });
        }} /></label>
      </div>)}
    </article>)}</div>
  </div>;
}
