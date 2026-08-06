import fotoBermudaLinho from "../assets/products/fotobermudalinho.jpeg";
import fotoCalcaViscolycra from "../assets/products/fotomodelocalcaviscolycra.jpeg";
import fotoPantacourtLinho from "../assets/products/fotopantacurcapa.jpeg";
import fotoShort from "../assets/products/shortviscolycra.png";


const IMAGES = {
  calca: fotoCalcaViscolycra,
  pantacourt: fotoPantacourtLinho,
  bermuda: fotoBermudaLinho,
  short: fotoShort,
};

const products = [
  {
    id: "calca-visco",
    name: "Calça Viscolycra",
    category: "Calças",
    material: "Viscolycra",
    price: 34.9,
    weight: 0.4,
    image: IMAGES.calca,
    colors: ["Preto", "Vinho", "Azul-marinho", "Estampada"],
  },
  {
    id: "calca-linho",
    name: "Calça Linho",
    category: "Calças",
    material: "Linho",
    price: 42.9,
    weight: 0.5,
    image: IMAGES.calca,
    colors: ["Areia", "Preto", "Terracota"],
  },
  {
    id: "calca-suplex",
    name: "Calça Suplex",
    category: "Calças",
    material: "Suplex",
    price: 39.9,
    weight: 0.6,
    image: IMAGES.calca,
    colors: ["Preto", "Chumbo", "Azul-marinho"],
  },
  {
    id: "panta-visco",
    name: "Pantacourt Viscolycra",
    category: "Pantacourts",
    material: "Viscolycra",
    price: 31.9,
    weight: 0.32,
    image: IMAGES.pantacourt,
    colors: ["Preto", "Caramelo", "Estampada"],
  },
  {
    id: "panta-linho",
    name: "Pantacourt Linho",
    category: "Pantacourts",
    material: "Linho",
    price: 39.9,
    weight: 0.4,
    image: IMAGES.pantacourt,
    colors: ["Areia", "Preto", "Oliva"],
  },
  {
    id: "bermuda-visco",
    name: "Bermuda Viscolycra",
    category: "Bermudas",
    material: "Viscolycra",
    price: 25.9,
    weight: 0.24,
    image: IMAGES.bermuda,
    colors: ["Preto", "Vinho", "Estampada"],
  },
  {
    id: "bermuda-linho",
    name: "Bermuda Linho",
    category: "Bermudas",
    material: "Linho",
    price: 32.9,
    weight: 0.32,
    image: IMAGES.bermuda,
    colors: ["Areia", "Preto", "Terracota"],
  },
  {
    id: "short-visco",
    name: "Short Viscolycra",
    category: "Shorts",
    material: "Viscolycra",
    price: 19.9,
    weight: 0.1,
    image: IMAGES.short,
    colors: ["Preto", "Pink", "Estampada"],
  },
];

const categories = [
  { name: "Calças", image: IMAGES.calca },
  { name: "Pantacourts", image: IMAGES.pantacourt },
  { name: "Bermudas", image: IMAGES.bermuda },
  { name: "Shorts", image: IMAGES.short },
];

export { products, categories };