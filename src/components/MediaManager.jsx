import React, { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const PAGE_SIZE = 24;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PURPOSE_LABELS = { product: "Produto", category: "Categoria", banner: "Banner", favicon: "Ícone", library: "Biblioteca" };

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Biblioteca de imagens com upload protegido: o servidor valida o arquivo real
// (JPEG/PNG/WebP, sem animação), recodifica removendo metadados e audita tudo.
export default function MediaManager() {
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const offsetRef = useRef(0);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [banners, setBanners] = useState([]);

  const [purpose, setPurpose] = useState("product");
  const [targetId, setTargetId] = useState("");
  const [optionId, setOptionId] = useState("");
  const [altText, setAltText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [primary, setPrimary] = useState(false);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [status, setStatus] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [confirmId, setConfirmId] = useState("");
  const fileInputRef = useRef(null);
  const previewRef = useRef("");

  const loadPage = async (reset) => {
    const run = ++generation.current;
    setLoading(true);
    setError("");
    const offset = reset ? 0 : offsetRef.current;
    try {
      const result = await api.admin.media({
        limit: PAGE_SIZE,
        offset,
        purpose: purposeFilter || undefined,
        q: query.trim() || undefined,
      });
      if (run !== generation.current) return;
      setAssets(previous => (reset ? result.assets : [...previous, ...result.assets]));
      setTotal(result.total ?? result.assets.length);
      offsetRef.current = offset + result.assets.length;
    } catch (requestError) {
      if (run !== generation.current) return;
      setError(requestError.message || "Não foi possível carregar as imagens.");
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };

  useEffect(() => {
    offsetRef.current = 0;
    const timer = setTimeout(() => { loadPage(true); }, 250);
    return () => clearTimeout(timer);
  }, [purposeFilter, query]);

  useEffect(() => {
    let active = true;
    Promise.all([api.admin.products(), api.admin.metadata(), api.admin.banners()]).then(([catalog, metadata, bannerList]) => {
      if (active) { setProducts(catalog.products); setCategories(metadata.categories); setBanners(bannerList.banners); }
    }).catch(requestError => { if (active) setStatus({ kind: "error", text: requestError.message }); });
    return () => { active = false; };
  }, []);

  const acceptFile = (candidate) => {
    if (!candidate) return;
    if (!ACCEPTED_TYPES.has(candidate.type) || candidate.size > MAX_IMAGE_BYTES) {
      setFile(null);
      setPreviewUrl("");
      setFileError("Escolha uma imagem JPEG, PNG ou WebP de até 5 MB.");
      return;
    }
    setFileError("");
    setFile(candidate);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(candidate);
    previewRef.current = url;
    setPreviewUrl(url);
  };

  const resetUpload = () => {
    setAltText("");
    setSortOrder(0);
    setPrimary(false);
    setFile(null);
    setPreviewUrl("");
    if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = ""; }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) { setFileError("Selecione uma imagem."); return; }
    const data = new FormData();
    data.append("purpose", purpose);
    if (targetId) data.append("targetId", targetId);
    if (optionId) data.append("optionId", optionId);
    data.append("primary", primary ? "true" : "false");
    data.append("sortOrder", String(sortOrder));
    data.append("altText", altText);
    data.append("file", file);
    setUploading(true);
    setStatus(null);
    try {
      await api.admin.uploadImage(data);
      setStatus({ kind: "success", text: "Imagem enviada e vinculada." });
      resetUpload();
      loadPage(true);
    } catch (uploadError) {
      setStatus({ kind: "error", text: uploadError.message });
    } finally {
      setUploading(false);
    }
  };

  const markBusy = (id, busy) => setBusyIds(previous => {
    const next = new Set(previous);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  const edit = async (image, body) => {
    markBusy(image.id, true);
    setStatus(null);
    try {
      await api.admin.updateImage(image.id, body);
      setStatus({ kind: "success", text: "Imagem atualizada." });
      loadPage(true);
    } catch (requestError) {
      setStatus({ kind: "error", text: requestError.message });
    } finally {
      markBusy(image.id, false);
    }
  };

  const remove = async (asset) => {
    setConfirmId("");
    markBusy(asset.id, true);
    setStatus(null);
    try {
      await api.admin.deleteMedia(asset.id);
      setStatus({ kind: "success", text: "Imagem excluída." });
      setAssets(previous => previous.filter(item => item.id !== asset.id));
      setTotal(value => Math.max(0, value - 1));
    } catch (requestError) {
      setStatus({ kind: "error", text: requestError.message });
    } finally {
      markBusy(asset.id, false);
    }
  };

  const inUse = (asset) => Boolean(
    asset.productImages?.length || asset.categoryImages?.length ||
    asset.banners?.length || asset.productOptionImages?.length,
  );

  const destinations = purpose === "product" ? products : purpose === "category" ? categories : banners;

  return (
    <div className="media-manager">
      <section className="media-panel" aria-label="Enviar imagem">
        <h2>Enviar imagem</h2>
        <p>JPEG, PNG ou WebP, até 5 MB. O servidor recodifica o arquivo e remove metadados (GPS etc.).</p>
        <form onSubmit={handleUpload} className="media-upload">
          <div className="media-fields">
            <label>Destino
              <select name="purpose" value={purpose} onChange={event => { setPurpose(event.target.value); setTargetId(""); setOptionId(""); }}>
                {Object.entries(PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {["product", "category", "banner"].includes(purpose) && (
              <label>Selecione
                <select name="targetId" value={targetId} required={purpose !== "banner"} onChange={event => setTargetId(event.target.value)}>
                  <option value="">{purpose === "banner" ? "Criar novo banner" : "Selecione"}</option>
                  {destinations.map(item => <option key={item.id} value={item.id}>{item.name ?? item.title}</option>)}
                </select>
              </label>
            )}
            {purpose === "product" && targetId && (
              <label>Cor ou estampa (opcional)
                <select name="optionId" value={optionId} onChange={event => setOptionId(event.target.value)}>
                  <option value="">Galeria geral do produto</option>
                  {products.find(item => item.id === targetId)?.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
            )}
            <label>Descrição
              <input name="altText" value={altText} maxLength={255} onChange={event => setAltText(event.target.value)} />
            </label>
            <label>Ordem
              <input name="sortOrder" type="number" min="0" max="999" value={sortOrder} onChange={event => setSortOrder(Number(event.target.value) || 0)} />
            </label>
            {purpose === "product" && (
              <label className="media-check"><input name="primary" type="checkbox" checked={primary} onChange={event => setPrimary(event.target.checked)} /> Usar como capa</label>
            )}
          </div>
          <div
            className={`media-dropzone ${dragging ? "dragging" : ""} ${previewUrl ? "has-preview" : ""}`}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files?.[0]); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} name="file" type="file" required accept="image/jpeg,image/png,image/webp" className="media-file-input" aria-label="Escolher arquivo" onChange={event => acceptFile(event.target.files?.[0])} />
            {previewUrl && <img src={previewUrl} alt="Prévia do upload" />}
            <p>{file ? <><strong>{file.name}</strong> · {formatBytes(file.size)}</> : "Arraste uma imagem aqui ou clique para escolher."}</p>
          </div>
          {fileError && <p className="media-file-error" role="alert">{fileError}</p>}
          <button className="button primary" disabled={uploading || !file} aria-busy={uploading}>
            Enviar imagem
          </button>
        </form>
      </section>

      <section className="media-library" aria-label="Biblioteca de imagens">
        <div className="media-library-head">
          <h2>Biblioteca</h2>
          <p>{total} {total === 1 ? "imagem" : "imagens"}</p>
          <input type="search" aria-label="Buscar por descrição" placeholder="Buscar por descrição" value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="Filtrar por destino" value={purposeFilter} onChange={event => setPurposeFilter(event.target.value)}>
            <option value="">Todos os destinos</option>
            {Object.entries(PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {error && <p className="media-status error" role="alert">{error}</p>}
        {status && <p className={`media-status ${status.kind}`} role="status">{status.text}</p>}
        {loading && assets.length === 0 ? (
          <p className="management-loading">Carregando…</p>
        ) : assets.length === 0 ? (
          <p className="media-empty">Nenhuma imagem encontrada.</p>
        ) : (
          <div className="media-grid">
            {assets.map(asset => {
              const busy = busyIds.has(asset.id) || uploading;
              const used = inUse(asset);
              const label = asset.altText || PURPOSE_LABELS[asset.purpose];
              return (
                <article className="media-card" key={asset.id}>
                  <div className="media-thumb">
                    <img src={asset.url} alt={label} loading="lazy" />
                    <span className={`media-badge purpose purpose-${asset.purpose}`}>{PURPOSE_LABELS[asset.purpose]}</span>
                    {used && <span className="media-badge in-use">Em uso</span>}
                  </div>
                  <div className="media-body">
                    <p className="media-title">{label}</p>
                    <small className="media-meta">{asset.width}×{asset.height} · {formatBytes(asset.byteSize)}</small>
                    {asset.productImages?.map(image => (
                      <div className="media-link" key={image.id}>
                        <small>{image.product.name}</small>
                        <button
                          className="button outline"
                          disabled={busy || image.type === "PRIMARY"}
                          aria-label={image.type === "PRIMARY" ? `Capa atual — ${image.product.name}` : `Usar como capa — ${image.product.name}`}
                          onClick={() => edit(image, { primary: true })}
                        >
                          {image.type === "PRIMARY" ? "Capa atual" : "Usar como capa"}
                        </button>
                        <label className="media-order">Ordem
                          <input
                            type="number"
                            min="0"
                            max="999"
                            defaultValue={image.sortOrder}
                            aria-label={`Ordem da foto de ${image.product.name}`}
                            disabled={busy}
                            onBlur={event => {
                              const value = Number(event.target.value);
                              if (Number.isInteger(value) && value >= 0 && value <= 999 && value !== image.sortOrder) edit(image, { sortOrder: value });
                            }}
                          />
                        </label>
                      </div>
                    ))}
                    {asset.categoryImages?.map(category => <div className="media-link" key={`category-${category.name}`}><small>Categoria: {category.name}</small></div>)}
                    {asset.banners?.map(banner => <div className="media-link" key={`banner-${banner.title}`}><small>Banner: {banner.title}</small></div>)}
                    {asset.productOptionImages?.map(option => <div className="media-link" key={option.id}><small>Cor: {option.variantOption?.name} · {option.product?.name}</small></div>)}
                    <div className="media-actions">
                      {confirmId === asset.id ? (
                        <div className="media-confirm">
                          <span>Excluir definitivamente?</span>
                          <button className="button danger" disabled={busy} onClick={() => remove(asset)}>Sim, excluir</button>
                          <button className="button outline" disabled={busy} onClick={() => setConfirmId("")}>Cancelar</button>
                        </div>
                      ) : (
                        <button
                          className="button danger outline"
                          disabled={used}
                          aria-label={`Excluir imagem ${label}`}
                          title={used ? "Imagem em uso" : undefined}
                          onClick={() => setConfirmId(asset.id)}
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {assets.length < total && (
          <button className="button outline media-more" onClick={() => loadPage(false)} disabled={loading}>
            {loading ? "Carregando…" : "Carregar mais"}
          </button>
        )}
      </section>
    </div>
  );
}
