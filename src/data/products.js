import fotoBermudaLinho from "../assets/products/fotobermudalinho.jpeg";
import fotoCalcaViscolycra from "../assets/products/fotomodelocalcaviscolycra.jpeg";
import fotoPantacourtLinho from "../assets/products/fotopantacurcapa.jpeg";
import fotoShort from "../assets/products/shortviscolycra.png";

const productImages = import.meta.glob(
  "../assets/products/**/*.{png,jpg,jpeg,webp}",
  {
    eager: true,
    import: "default",
  }
);

function getImage(path) {
  const imagePath = `../assets/products/${path}`;
  return productImages[imagePath];
}

const IMAGES = {
  calcaViscolycraLisa: [
    getImage("calca_viscolycra_lisa/calcaviscolycrafotomodelo1.jpeg"),
    getImage("calca_viscolycra_lisa/calcaviscolycrafotomodelo2.jpeg"),
    getImage("calca_viscolycra_lisa/calcaviscolycrafotomodelo3.jpeg"),
  ],

  calcaViscolycraEstampada: [
    getImage("calca_viscolycra_estampada/calcaestampadamodelo1.jpeg"),
    getImage("calca_viscolycra_estampada/calcaestampadamodelo2.jpeg"),
    getImage("calca_viscolycra_estampada/calcaestampadamodelo3.jpeg"),
  ],

  calcaLinho: [
    getImage("calca_linho/calcalinhomodelo1.jpeg"),
    getImage("calca_linho/calcalinhomodelo2.jpeg"),
    getImage("calca_linho/calcalinhomodelo3.jpeg"),
  ],

  pantacourtLinho: [
    getImage("pantacourt_linho/pantacourtlinhomodelo1.jpeg"),
    getImage("pantacourt_linho/pantacourtlinhomodelo2.jpeg"),
    getImage("pantacourt_linho/pantacourtlinhomodelo3.jpeg"),
  ],

  bermudaLinho: [
    getImage("bermuda_linho/bermudalinhomodelo1.jpeg"),
    getImage("bermuda_linho/bermudalinhomodelo2.jpeg"),
    getImage("bermuda_linho/bermudalinhomodelo3.jpeg"),
  ],

  capriViscolycraEstampada: [
    getImage("capri_estampada/capriestampadamodelo1.jpeg"),
    getImage("capri_estampada/capriestampadamodelo2.jpeg"),
    getImage("capri_estampada/capriestampadamodelo3.jpeg"),
  ],

  short: [
    fotoShort,
  ],

  bermudaViscolycraLisa: [
    getImage("bermuda_viscolycra_lisa/bermudaviscolycralisapeca1.jpeg"),
  ],
};

const products = [
  {
    id: "calca-visco",
    name: "Calça de Malha Viscolycra",
    category: "Calças",
    material: "Viscolycra",
    price: 25.0,
    weight: 0.4,

    // Imagem principal do produto
    image: IMAGES.calcaViscolycraLisa[0],

    // Fotos do modelo
    images: IMAGES.calcaViscolycraLisa,

    // Cores disponíveis e futuras imagens de cada cor
    variants: [
      {
        name: "Preto",
        image: null,
      },
      {
        name: "Grafite",
        image: null,
      },
      {
        name: "Cinza claro",
        image: null,
      },
      {
        name: "Verde militar",
        image: null,
      },
      {
        name: "Azul marinho",
        image: null,
      },
      {
        name: "Vinho",
        image: null,
      },
      {
        name: "Marrom",
        image: null,
      },
      {
        name: "Marrom claro",
        image: null,
      },
    ],
  },

  {
    id: "calca-visco-estampada",
    name: "Calça Viscolycra Estampada",
    category: "Calças",
    material: "Viscolycra",
    price: 27.0,
    weight: 0.4,

    image: IMAGES.calcaViscolycraEstampada[0],
    images: IMAGES.calcaViscolycraEstampada,

    // Variantes de cores disponíveis para o produto
    variants: [
      {
        name: "Mais escuras",
        image: null,
      },
      {
        name: "Mais claras",
        image: null,
      },
      {
        name: "Misturadas",
        image: null,
      }
    ]
  },

  {
    id: "calca-linho",
    name: "Calça Linho",
    category: "Calças",
    material: "Linho",
    price: 36.0,
    weight: 0.5,

    image: IMAGES.calcaLinho[0],

    images: IMAGES.calcaLinho,

    variants: [
      {
        name: "Preto",
        image: null
      },
      {
        name: "Creme",
        image: null
      },
      {
        name: "Verde escuro",
        image: null
      },
      {
        name: "Verde claro",
        image: null
      },
      {
        name: "Vinho",
        image: null
      },
      {
        name: "Azul escuro",
        image: null
      },
      {
        name: "Azul claro",
        image: null
      },
      {
        name: "Rose",
        image: null
      },
    ],
  },

  {
    id: "pantacourt-linho",
    name: "Pantacourt Linho",
    category: "Pantacourts",
    material: "Linho",
    price: 35.0,
    weight: 0.4,

    image: IMAGES.pantacourtLinho[0],

    images: IMAGES.pantacourtLinho,

    variants: [
      {
        name: "Preto",
        image: null
      },
      {
        name: "Creme",
        image: null
      },
      {
        name: "Verde escuro",
        image: null
      },
      {
        name: "Verde claro",
        image: null
      },
      {
        name: "Vinho",
        image: null
      },
      {
        name: "Azul escuro",
        image: null
      },
      {
        name: "Azul claro",
        image: null
      },
      {
        name: "Rose",
        image: null
      },
    ],
  },

  {
    id: "bermuda-linho",
    name: "Bermuda Linho",
    category: "Bermudas",
    material: "Linho",
    price: 25.0,
    weight: 0.32,

    image: IMAGES.bermudaLinho[0],

    images: IMAGES.bermudaLinho,

    variants: [
      {
        name: "Preto",
        image: null
      },
      {
        name: "Creme",
        image: null
      },
      {
        name: "Verde escuro",
        image: null
      },
      {
        name: "Verde claro",
        image: null
      },
      {
        name: "Vinho",
        image: null
      },
      {
        name: "Azul escuro",
        image: null
      },
      {
        name: "Azul claro",
        image: null
      },
      {
        name: "Rose",
        image: null
      },
    ],
  },

  {
    id: "capri-visco-estampada",
    name: "Capri Viscolycra Estampada",
    category: "Capris",
    material: "Viscolycra",
    price: 20.0,
    weight: 0.3,


    image: IMAGES.capriViscolycraEstampada[0],

    images: IMAGES.capriViscolycraEstampada,

    variants: [
      {
        name: "Mais escuras",
        image: null,
      },
      {
        name: "Mais claras",
        image: null,
      },
      {
        name: "Misturadas",
        image: null,
      },
    ],
  },

  {
    id: "short-visco",
    name: "Short Viscolycra",
    category: "Shorts",
    material: "Viscolycra",
    price: 15.0,
    weight: 0.1,

    image: IMAGES.short[0],

    images: IMAGES.short,

    variants: [
      {
        name: "Preto",
        image: null,
      },
      {
        name: "Grafite",
        image: null,
      },
      {
        name: "Cinza claro",
        image: null,
      },
      {
        name: "Verde militar",
        image: null,
      },
      {
        name: "Azul marinho",
        image: null,
      },
      {
        name: "Vinho",
        image: null,
      },
      {
        name: "Marrom",
        image: null,
      },
      {
        name: "Marrom claro",
        image: null,
      },
    ],
  },

  {
    id: "bermuda-visco-lisa",
    name: "Bermuda Viscolycra Lisa",
    category: "Bermuda",
    material: "Viscolycra",
    price: 18.0,
    weight: 0.1,

    image: IMAGES.bermudaViscolycraLisa[0],

    images: IMAGES.bermudaViscolycraLisa,

    variants: [
      {
        name: "Preto",
        image: null,
      },
      {
        name: "Grafite",
        image: null,
      },
      {
        name: "Cinza claro",
        image: null,
      },
      {
        name: "Verde militar",
        image: null,
      },
      {
        name: "Azul marinho",
        image: null,
      },
      {
        name: "Vinho",
        image: null,
      },
      {
        name: "Marrom",
        image: null,
      },
      {
        name: "Marrom claro",
        image: null,
      },
    ],
  },
];

const categories = [
  {
    name: "Calças",
    image: IMAGES.calcaViscolycraLisa[0],
  },
  {
    name: "Pantacourts",
    image: IMAGES.pantacourtLinho[0],
  },
  {
    name: "Bermudas",
    image: IMAGES.bermudaLinho[1],
  },
  {
    name: "Shorts",
    image: IMAGES.short[0],
  },
];

export { products, categories };