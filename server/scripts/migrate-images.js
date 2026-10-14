import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { inspectImage, IMAGE_TYPES, MAX_IMAGE_BYTES } from "../src/lib/images.js";
import { putImage, STORAGE_BUCKET } from "../src/services/storage.service.js";

const root = new URL("../../", import.meta.url);
const manifestUrl = new URL("server/prisma/data/storage-images.json", root);
const productFolders = {
  calca_viscolycra_lisa: "calca-malha-viscolycra", calca_viscolycra_estampada: "calca-viscolycra-estampada",
  calca_linho: "calca-linho", pantacourt_linho: "pantacourt-linho", bermuda_linho: "bermuda-linho",
  capri_estampada: "capri-viscolycra-estampada", bermuda_viscolycra_lisa: "bermuda-viscolycra-lisa",
};
const galleries = {
  "calca-malha-viscolycra": [1,2,3].map(n=>`products/calca_viscolycra_lisa/calcaviscolycrafotomodelo${n}.jpeg`),
  "calca-viscolycra-estampada": [1,2,3].map(n=>`products/calca_viscolycra_estampada/calcaestampadamodelo${n}.jpeg`),
  "calca-linho": [1,2,3].map(n=>`products/calca_linho/calcalinhomodelo${n}.jpeg`),
  "pantacourt-linho": [1,2,3].map(n=>`products/pantacourt_linho/pantacourtlinhomodelo${n}.jpeg`),
  "bermuda-linho": [1,2,3].map(n=>`products/bermuda_linho/bermudalinhomodelo${n}.jpeg`),
  "capri-viscolycra-estampada": [1,2,3].map(n=>`products/capri_estampada/capriestampadamodelo${n}.jpeg`),
  "short-viscolycra": ["products/shortviscolycra.png"],
  "bermuda-viscolycra-lisa": ["products/bermuda_viscolycra_lisa/bermudaviscolycralisapeca1.jpeg"],
};
async function verify(file) {
  const response = await fetch(file.url, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error(`Imagem indisponível: ${file.source}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.byteSize || createHash("sha256").update(bytes).digest("hex") !== file.checksumSha256) {
    throw new Error(`Conteúdo diferente: ${file.source}`);
  }
}
async function walk(directory, prefix="") {
  const result=[];
  for(const item of await readdir(directory,{withFileTypes:true})) {
    if(item.isDirectory())result.push(...await walk(new URL(`${item.name}/`,directory),`${prefix}${item.name}/`));
    else result.push(`${prefix}${item.name}`);
  }
  return result.sort();
}
try {
  if(process.argv.includes("--verify")) {
    const manifest=JSON.parse(await readFile(manifestUrl,"utf8"));
    for(const file of manifest.files) {
      await verify(file);
      const asset=await prisma.mediaAsset.findUnique({where:{storageBucket_storagePath:{storageBucket:STORAGE_BUCKET,storagePath:file.storagePath}}});
      if(!asset || asset.checksumSha256!==file.checksumSha256)throw new Error(`Registro ausente: ${file.source}`);
    }
    console.log(`Verificadas ${manifest.files.length} imagens públicas e seus registros.`);
  } else {
    const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:bucket,error}=await admin.storage.getBucket(STORAGE_BUCKET);
    if(error) {
      const created=await admin.storage.createBucket(STORAGE_BUCKET,{public:true,fileSizeLimit:MAX_IMAGE_BYTES,allowedMimeTypes:Object.values(IMAGE_TYPES)});
      if(created.error)throw new Error("Não foi possível criar o bucket de imagens.");
    } else if(!bucket.public || Number(bucket.file_size_limit)!==MAX_IMAGE_BYTES)throw new Error("Configuração do bucket diferente da esperada.");
    const products=await prisma.product.findMany();
    const bySlug=new Map(products.map(p=>[p.slug,p]));
    for(const slug of Object.keys(galleries))if(!bySlug.has(slug))throw new Error(`Produto ausente: ${slug}`);
    const assetsDir=new URL("src/assets/",root);
    const files=[];
    for(const source of await walk(assetsDir)) {
      const buffer=await readFile(new URL(source,assetsDir));
      const info=await inspectImage(buffer);
      const folder=source.split('/')[1];
      const slug=source==="products/shortviscolycra.png"?"short-viscolycra":productFolders[folder];
      const purpose=source==="hero.jpeg"?"banner":source==="logoferchumodas.jpeg"?"favicon":slug?"product":"library";
      const storagePath=`${purpose}/${slug?bySlug.get(slug).id:"site"}/${info.checksumSha256}.${info.extension}`;
      const existing=await prisma.mediaAsset.findUnique({where:{storageBucket_storagePath:{storageBucket:STORAGE_BUCKET,storagePath}}});
      const url=existing?.url ?? await putImage(storagePath,buffer,info.mimeType);
      const file={source,storagePath,url,purpose,...info};
      delete file.extension;
      await verify(file);
      files.push(file);
    }
    await prisma.$transaction(async tx=>{
      const ids=new Map();
      for(const file of files) {
        const {source,...data}=file;
        const asset=await tx.mediaAsset.upsert({where:{storageBucket_storagePath:{storageBucket:STORAGE_BUCKET,storagePath:file.storagePath}},
          create:{...data,storageBucket:STORAGE_BUCKET,altText:source},update:{}});
        ids.set(source,asset.id);
      }
      for(const [slug,photos] of Object.entries(galleries)) {
        const product=bySlug.get(slug);
        const existing=await tx.productImage.count({where:{productId:product.id}});
        // Resume only our exact associations; do not overwrite user-managed media.
        if(existing && await tx.productImage.count({where:{productId:product.id,assetId:{in:photos.map(p=>ids.get(p))}}})!==existing)throw new Error(`Galeria já alterada: ${slug}`);
        for(let order=0;order<photos.length;order++) {
          const assetId=ids.get(photos[order]);if(!assetId)throw new Error("Arquivo de galeria ausente.");
          await tx.productImage.upsert({where:{productId_assetId:{productId:product.id,assetId}},
            create:{productId:product.id,assetId,type:order===0?"PRIMARY":"SECONDARY",sortOrder:order},update:{}});
        }
      }
      const categoryImages={calcas:galleries['calca-malha-viscolycra'][0],pantacourts:galleries['pantacourt-linho'][0],
        bermudas:galleries['bermuda-linho'][1],capris:galleries['capri-viscolycra-estampada'][0],shorts:galleries['short-viscolycra'][0]};
      for(const [slug,source] of Object.entries(categoryImages)) {
        const category=await tx.category.findUnique({where:{slug}});
        if(category && !category.imageAssetId)await tx.category.update({where:{id:category.id},data:{imageAssetId:ids.get(source)}});
      }
      const heroId=ids.get('hero.jpeg');
      if(!await tx.siteBanner.findFirst({where:{assetId:heroId}}))await tx.siteBanner.create({data:{assetId:heroId,title:'Ferchu Modas',subtitle:'Peças confortáveis e modelos variados para revender.',linkUrl:'#catalogo'}});
    },{timeout:60000});
    await mkdir(new URL("server/prisma/data/",root),{recursive:true});
    await writeFile(manifestUrl,JSON.stringify({bucket:STORAGE_BUCKET,files},null,2)+"\n");
    console.log(JSON.stringify({uploadedAndVerified:files.length,hero:files.find(f=>f.source==='hero.jpeg').url,favicon:files.find(f=>f.source==='logoferchumodas.jpeg').url}));
  }
} catch(error) {console.error("Migração de imagens interrompida:",error instanceof Error&&!error.code?error.message:error.code??"MEDIA_FAILED");process.exitCode=1;}
finally{await prisma.$disconnect();}
