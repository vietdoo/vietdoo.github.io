import { createSignal, createMemo, onMount, onCleanup } from "solid-js";
import * as d3 from "d3";
import vietnamData from "../lib/maps/vietnam-provinces.json";
import worldData from "../lib/world.json";
import { SITE } from "../site-config";

type ProvinceInfo = {
  vi: string;
  region: string;
  labelDx?: number;
  labelDy?: number;
  coverImage?: string;
  highlights?: string[];
  travelDate?: string;
};

const PROVINCE_MAP: Record<string, ProvinceInfo> = {
  "An Giang": {
    vi: "An Giang",
    region: "Tây Nam Bộ",
    coverImage: "/travel/an_giang.jpg",
    highlights: [
      "Rừng tràm Trà Sư",
      "Miếu Bà Chúa Xứ",
      "Hồ Tà Pạ",
      "Chợ Châu Đốc",
    ],
  },
  "Bac Ninh": {
    vi: "Bắc Ninh",
    region: "Đồng bằng sông Hồng",
    coverImage: "/travel/bac_ninh.jpg",
    highlights: ["Chùa Dâu", "Đền Đô", "Chùa Bút Tháp", "Làng tranh Đông Hồ"],
  },
  "Ca Mau": {
    vi: "Cà Mau",
    region: "Tây Nam Bộ",
    coverImage: "/travel/ca_mau.jpg",
    highlights: [
      "Mũi Cà Mau",
      "Rừng U Minh Hạ",
      "Hòn Đá Bạc",
      "Chợ nổi Cà Mau",
    ],
  },
  "Can Tho": {
    vi: "Cần Thơ",
    region: "Tây Nam Bộ",
    coverImage: "/travel/can_tho.jpg",
    highlights: [
      "Bến Ninh Kiều",
      "Chợ nổi Cái Răng",
      "Nhà cổ Bình Thủy",
      "Cầu Cần Thơ",
    ],
  },
  "Cao Bang": {
    vi: "Cao Bằng",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/cao_bang.jpg",
    highlights: [
      "Thác Bản Giốc",
      "Động Ngườm Ngao",
      "Pác Bó - Suối Lê Nin",
      "Thác Cò Cùng",
    ],
  },
  "Da Nang": {
    vi: "Đà Nẵng",
    region: "Nam Trung Bộ",
    labelDx: 16,
    labelDy: 4,
    coverImage: "/travel/danang_1.jpg",
    highlights: ["Cầu Vàng", "Bà Nà Hills", "Cầu Rồng", "Biển Mỹ Khê"],
    travelDate: "Đã ghé thăm • Mùa hè 2024",
  },
  "Dak Lak": {
    vi: "Đắk Lắk",
    region: "Tây Nguyên",
    coverImage: "/travel/dak_lak.jpg",
    highlights: ["Bảo tàng Cà phê", "Hồ Lắk", "Thác Dray Nur", "Buôn Đôn"],
  },
  "Dien Bien": {
    vi: "Điện Biên",
    region: "Tây Bắc Bộ",
    coverImage: "/travel/dien_bien.jpg",
    highlights: [
      "Đồi A1",
      "Chiến thắng Điện Biên Phủ",
      "Hầm De Castries",
      "Cánh đồng Mường Thanh",
    ],
  },
  "Dong Nai": {
    vi: "Đồng Nai",
    region: "Đông Nam Bộ",
    coverImage: "/travel/dong_nai.jpg",
    highlights: [
      "Vườn quốc gia Cát Tiên",
      "Thác Giang Điền",
      "Hồ Trị An",
      "KDL Bửu Long",
    ],
    travelDate: "Đã ghé thăm • 2024",
  },
  "Dong Thap": {
    vi: "Đồng Tháp",
    region: "Tây Nam Bộ",
    coverImage: "/travel/dong_thap.jpg",
    highlights: [
      "Làng hoa Sa Đéc",
      "VQG Tràm Chim",
      "Khu di tích Xẻo Quýt",
      "Đồng sen Tháp Mười",
    ],
  },
  "Gia Lai": {
    vi: "Gia Lai",
    region: "Tây Nguyên",
    coverImage: "/travel/gia_lai.jpg",
    highlights: [
      "Biển Hồ T'Nưng",
      "Chư Đăng Ya",
      "Thác Phú Cường",
      "Quảng trường Đại Đoàn Kết",
    ],
  },
  "Ha Noi": {
    vi: "Hà Nội",
    region: "Đồng bằng sông Hồng",
    labelDx: 16,
    labelDy: -4,
    coverImage: "/travel/hanoi_1.jpg",
    highlights: ["Hồ Hoàn Kiếm", "Phố Cổ", "Văn Miếu", "Ẩm thực Hà Nội"],
    travelDate: "Đã ghé thăm • Mùa thu 2024",
  },
  "Ha Tinh": {
    vi: "Hà Tĩnh",
    region: "Bắc Trung Bộ",
    coverImage: "/travel/ha_tinh.jpg",
    highlights: [
      "Hồ Kẻ Gỗ",
      "Ngã ba Đồng Lộc",
      "Biển Thiên Cầm",
      "Chùa Hương Tích",
    ],
  },
  "Hai Phong": {
    vi: "Hải Phòng",
    region: "Đồng bằng sông Hồng",
    labelDx: 16,
    labelDy: -4,
    coverImage: "/travel/hai_phong.jpg",
    highlights: ["Đảo Cát Bà", "Vịnh Lan Hạ", "Biển Đồ Sơn", "Tuyệt Tình Cốc"],
    travelDate: "Đã ghé thăm • Mùa thu 2024",
  },
  "Ho Chi Minh": {
    vi: "TP. Hồ Chí Minh",
    region: "Đông Nam Bộ",
    labelDx: 16,
    labelDy: 4,
    coverImage: "/travel/saigon_1.jpg",
    highlights: [
      "Nhà thờ Đức Bà",
      "Landmark 81",
      "Bưu điện TP",
      "Phố Nguyễn Huệ",
    ],
    travelDate: "Đã ghé thăm • 2025",
  },
  Hue: {
    vi: "Thừa Thiên Huế",
    region: "Bắc Trung Bộ",
    coverImage: "/travel/hue.jpg",
    highlights: [
      "Đại Nội Huế",
      "Chùa Thiên Mụ",
      "Lăng Khải Định",
      "Sông Hương",
    ],
  },
  "Hung Yen": {
    vi: "Hưng Yên",
    region: "Đồng bằng sông Hồng",
    coverImage: "/travel/hung_yen.jpg",
    highlights: ["Phố Hiến", "Đền Đồng Tử Vương", "Chùa Nôm", "Làng Nôm cổ"],
  },
  "Khanh Hoa": {
    vi: "Khánh Hòa",
    region: "Nam Trung Bộ",
    coverImage: "/travel/khanh_hoa.jpg",
    highlights: [
      "Vịnh Nha Trang",
      "Đảo Điệp Sơn",
      "Tháp Bà Ponagar",
      "VinWonders",
    ],
    travelDate: "Đã ghé thăm • 2024",
  },
  "Lai Chau": {
    vi: "Lai Châu",
    region: "Tây Bắc Bộ",
    coverImage: "/travel/lai_chau.jpg",
    highlights: [
      "Đèo Ô Quy Hồ",
      "Đỉnh Putaleng",
      "Cao nguyên Sìn Hồ",
      "Bản Sin Suối Hồ",
    ],
  },
  "Lam Dong": {
    vi: "Lâm Đồng",
    region: "Tây Nguyên",
    coverImage: "/travel/lam_dong.jpg",
    highlights: [
      "Hồ Xuân Hương",
      "Thung Lũng Tình Yêu",
      "Dinh Bảo Đại",
      "Đồi chè Cầu Đất",
    ],
    travelDate: "Đã ghé thăm • Mùa đông 2024",
  },
  "Lang Son": {
    vi: "Lạng Sơn",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/lang_son.jpg",
    highlights: [
      "Đỉnh Mẫu Sơn",
      "Động Tam Thanh",
      "Ải Chi Lăng",
      "Chợ Tân Thanh",
    ],
  },
  "Lao Cai": {
    vi: "Lào Cai",
    region: "Tây Bắc Bộ",
    coverImage: "/travel/lao_cai.jpg",
    highlights: ["Sapa", "Đỉnh Fansipan", "Bản Cát Cát", "Y Tý"],
  },
  "Nghe An": {
    vi: "Nghệ An",
    region: "Bắc Trung Bộ",
    coverImage: "/travel/nghe_an.jpg",
    highlights: [
      "Biển Cửa Lò",
      "Khu di tích Kim Liên",
      "Đồi chè Thanh Chương",
      "VQG Pù Mát",
    ],
  },
  "Ninh Binh": {
    vi: "Ninh Bình",
    region: "Đồng bằng sông Hồng",
    coverImage: "/travel/ninh_binh.jpg",
    highlights: [
      "Quần thể Tràng An",
      "Chùa Bái Đính",
      "Hang Múa",
      "Tam Cốc - Bích Động",
    ],
    travelDate: "Đã ghé thăm • Mùa xuân 2024",
  },
  "Phu Tho": {
    vi: "Phú Thọ",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/phu_tho.jpg",
    highlights: [
      "Khu di tích Đền Hùng",
      "Đồi chè Long Cốc",
      "VQG Xuân Sơn",
      "Đầm Long",
    ],
  },
  "Quang Ngai": {
    vi: "Quảng Ngãi",
    region: "Nam Trung Bộ",
    coverImage: "/travel/quang_ngai.jpg",
    highlights: ["Đảo Lý Sơn", "Mũi Ba Làng An", "Biển Mỹ Khê", "Đèo Vi Ô Lắc"],
  },
  "Quang Ninh": {
    vi: "Quảng Ninh",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/quang_ninh.jpg",
    highlights: ["Vịnh Hạ Long", "Đảo Cô Tô", "Yên Tử", "Vân Đồn"],
  },
  "Quang Tri": {
    vi: "Quảng Trị",
    region: "Bắc Trung Bộ",
    coverImage: "/travel/quang_tri.jpg",
    highlights: [
      "Thành cổ Quảng Trị",
      "Địa đạo Vịnh Mốc",
      "Cầu Hiền Lương",
      "Nghĩa trang Trường Sơn",
    ],
  },
  "Son La": {
    vi: "Sơn La",
    region: "Tây Bắc Bộ",
    coverImage: "/travel/son_la.jpg",
    highlights: [
      "Mộc Châu",
      "Đèo Chín Dốc",
      "Rừng thông Bản Áng",
      "Thác Dải Yếm",
    ],
  },
  "Tay Ninh": {
    vi: "Tây Ninh",
    region: "Đông Nam Bộ",
    coverImage: "/travel/tay_ninh.jpg",
    highlights: [
      "Núi Bà Đen",
      "Tòa Thánh Tây Ninh",
      "Hồ Dầu Tiếng",
      "Ma Thiên Lãnh",
    ],
    travelDate: "Đã ghé thăm • 2024",
  },
  "Thai Nguyen": {
    vi: "Thái Nguyên",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/thai_nguyen.jpg",
    highlights: [
      "Hồ Núi Cốc",
      "Đồi chè Tân Cương",
      "Hang Phượng Hoàng",
      "ATK Định Hóa",
    ],
  },
  "Thanh Hoa": {
    vi: "Thanh Hóa",
    region: "Bắc Trung Bộ",
    coverImage: "/travel/thanh_hoa.jpg",
    highlights: [
      "Bãi biển Sầm Sơn",
      "Thành Nhà Hồ",
      "Pù Luông",
      "Suối cá thần Cẩm Lương",
    ],
    travelDate: "Đã ghé thăm • Mùa hè 2024",
  },
  "Tuyen Quang": {
    vi: "Tuyên Quang",
    region: "Đông Bắc Bộ",
    coverImage: "/travel/tuyen_quang.jpg",
    highlights: [
      "Khu di tích Tân Trào",
      "Hồ Na Hang",
      "Thác Mơ",
      "Suối khoáng Mỹ Lâm",
    ],
  },
  "Vinh Long": {
    vi: "Vĩnh Long",
    region: "Tây Nam Bộ",
    coverImage: "/travel/vinh_long.jpg",
    highlights: [
      "Cù lao An Bình",
      "Chợ nổi Trà Ô",
      "Văn Thánh Miếu",
      "Làng gạch Mang Thít",
    ],
  },
};

const COUNTRY_NAME_VN: Record<string, string> = {
  Laos: "Lào",
  Cambodia: "Campuchia",
  Thailand: "Thái Lan",
  China: "Trung Quốc",
  Philippines: "Philippines",
  Malaysia: "Malaysia",
  Myanmar: "Myanmar",
  Taiwan: "Đài Loan",
};

const NEIGHBOR_NAMES = new Set([
  "Laos",
  "Cambodia",
  "Thailand",
  "China",
  "Philippines",
  "Malaysia",
  "Myanmar",
  "Taiwan",
]);

// Clean Dark Slate Palette matching Bento Portfolio theme
const OCEAN_FILL = "#0a131d";
const OCEAN_STIPPLE = "#16283d";
const PROVINCE_DEFAULT_FILL = "rgba(30, 56, 84, 0.75)";
const PROVINCE_HOVER_FILL = "rgba(44, 84, 122, 0.9)";
const PROVINCE_STROKE = "#3c648d";
const WORLD_COUNTRY_FILL = "none";
const WORLD_COUNTRY_HOVER_FILL = "rgba(51, 65, 85, 0.3)";
const WORLD_COUNTRY_STROKE = "none";
const GRATICULE_STROKE = "#16283b";
const TOOLTIP_BG = "#0c131d";
const TOOLTIP_BORDER = "#334155";

export default function VietnamMap() {
  let containerRef: HTMLDivElement | undefined;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let svgSelection: d3.Selection<
    SVGSVGElement,
    unknown,
    null,
    undefined
  > | null = null;

  const visitedProvinces = (SITE as any).visitedProvinces || [
    "Ha Noi",
    "Ho Chi Minh",
    "Da Nang",
  ];
  const [visited] = createSignal<string[]>(visitedProvinces);

  const [selectedProvince, setSelectedProvince] = createSignal<{
    name: string;
    info: ProvinceInfo;
    isVisited: boolean;
  } | null>(null);

  const [isStatsCollapsed, setIsStatsCollapsed] = createSignal(false);

  const handleZoomIn = () => {
    if (svgSelection && zoomBehavior) {
      svgSelection
        .transition()
        .duration(300)
        .call(zoomBehavior.scaleBy as any, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (svgSelection && zoomBehavior) {
      svgSelection
        .transition()
        .duration(300)
        .call(zoomBehavior.scaleBy as any, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgSelection && zoomBehavior) {
      svgSelection
        .transition()
        .duration(500)
        .call(zoomBehavior.transform as any, d3.zoomIdentity);
    }
  };

  onMount(() => {
    if (!containerRef) return;

    // Clean up any leftover tooltips from previous DOM states
    d3.select("body").selectAll(".vn-map-tooltip").remove();

    const renderMap = () => {
      if (!containerRef) return;

      d3.select(containerRef).selectAll("*").remove();

      const width = Math.max(
        containerRef.clientWidth || window.innerWidth,
        320,
      );
      const height = Math.max(
        containerRef.clientHeight || window.innerHeight,
        400,
      );
      const isMobile = width < 640;

      const svg = d3
        .select(containerRef)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("background", OCEAN_FILL);

      svgSelection = svg as any;

      // Defs pattern for sea stipple texture & glow filter
      const defs = svg.append("defs");

      const stipple = defs
        .append("pattern")
        .attr("id", "vn-sea-stipple")
        .attr("width", 6)
        .attr("height", 6)
        .attr("patternUnits", "userSpaceOnUse");

      stipple
        .append("rect")
        .attr("width", 6)
        .attr("height", 6)
        .attr("fill", OCEAN_FILL);
      stipple
        .append("circle")
        .attr("cx", 1.5)
        .attr("cy", 1.5)
        .attr("r", 0.5)
        .attr("fill", OCEAN_STIPPLE);
      stipple
        .append("circle")
        .attr("cx", 4.5)
        .attr("cy", 4.5)
        .attr("r", 0.5)
        .attr("fill", OCEAN_STIPPLE);

      // Glow filter for visited provinces & beacons
      const filter = defs
        .append("filter")
        .attr("id", "visited-glow")
        .attr("x", "-20%")
        .attr("y", "-20%")
        .attr("width", "140%")
        .attr("height", "140%");
      filter
        .append("feGaussianBlur")
        .attr("stdDeviation", "2")
        .attr("result", "coloredBlur");
      const feMerge = filter.append("feMerge");
      feMerge.append("feMergeNode").attr("in", "coloredBlur");
      feMerge.append("feMergeNode").attr("in", "SourceGraphic");

      // Ocean background
      svg
        .append("rect")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("fill", "url(#vn-sea-stipple)")
        .on("click", () => {
          setSelectedProvince(null);
        });

      // CARTO Map Tiles layer group (rendered below vector map features)
      const tilesGroup = svg.append("g").attr("class", "carto-tiles-group");

      // Tight bounding box feature focused on Vietnam + ~200km surrounding region
      // Lon: 100.5°E to 115.0°E, Lat: 7.5°N to 24.5°N
      const targetExtent = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [100.5, 7.5] },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [115.0, 24.5] },
          },
        ],
      };

      const features = (vietnamData as any).features;

      // Fit map extent taking into account top navbar and bottom floating cards on mobile
      const paddingBounds = isMobile
        ? [
            [16, 75],
            [width - 16, height - 160],
          ]
        : [
            [25, 25],
            [width - 25, height - 25],
          ];

      const projection = d3
        .geoMercator()
        .fitExtent(
          paddingBounds as [[number, number], [number, number]],
          targetExtent as any,
        );

      const pathGenerator = d3.geoPath().projection(projection);

      // Dynamic CARTO Dark Matter tile renderer
      const updateTiles = (transform = d3.zoomIdentity) => {
        const scale = projection.scale() * transform.k;
        const translate = projection.translate();
        const tx = translate[0] * transform.k + transform.x;
        const ty = translate[1] * transform.k + transform.y;

        const worldWidth = 2 * Math.PI * scale;
        const z = Math.max(
          2,
          Math.min(12, Math.floor(Math.log2(worldWidth / 256))),
        );
        const numTiles = 1 << z;
        const tileSizeProj = worldWidth / numTiles;

        const x0 = tx - Math.PI * scale;
        const y0 = ty - Math.PI * scale;

        const buffer = 256;
        const minX = -buffer;
        const minY = -buffer;
        const maxX = width + buffer;
        const maxY = height + buffer;

        const minTileX = Math.max(0, Math.floor((minX - x0) / tileSizeProj));
        const maxTileX = Math.min(
          numTiles - 1,
          Math.floor((maxX - x0) / tileSizeProj),
        );
        const minTileY = Math.max(0, Math.floor((minY - y0) / tileSizeProj));
        const maxTileY = Math.min(
          numTiles - 1,
          Math.floor((maxY - y0) / tileSizeProj),
        );

        const tiles: {
          id: string;
          url: string;
          x: number;
          y: number;
          size: number;
        }[] = [];
        const subdomains = ["a", "b", "c"];

        const cartoApiKey = import.meta.env.PUBLIC_CARTO_API_KEY || "";
        const keyParam = cartoApiKey ? `?key=${cartoApiKey}` : "";

        for (let tyIdx = minTileY; tyIdx <= maxTileY; tyIdx++) {
          for (let txIdx = minTileX; txIdx <= maxTileX; txIdx++) {
            const tileX = x0 + txIdx * tileSizeProj;
            const tileY = y0 + tyIdx * tileSizeProj;
            const subdomain = subdomains[(txIdx + tyIdx) % subdomains.length];
            const url = `https://${subdomain}.basemaps.cartocdn.com/dark_nolabels/${z}/${txIdx}/${tyIdx}.png${keyParam}`;
            tiles.push({
              id: `${z}-${txIdx}-${tyIdx}`,
              url,
              x: tileX,
              y: tileY,
              size: tileSizeProj,
            });
          }
        }

        const images = tilesGroup
          .selectAll<SVGImageElement, (typeof tiles)[0]>("image")
          .data(tiles, (d) => d.id);

        images.exit().remove();

        images
          .enter()
          .append("image")
          .attr("href", (d) => d.url)
          .style("opacity", "0.85")
          .merge(images as any)
          .attr("x", (d) => d.x)
          .attr("y", (d) => d.y)
          .attr("width", (d) => d.size)
          .attr("height", (d) => d.size)
          .attr("preserveAspectRatio", "none");
      };

      updateTiles(d3.zoomIdentity);

      const mapGroup = svg.append("g").attr("class", "map-group");

      // Graticule
      const graticule = d3.geoGraticule().step([2, 2])();
      mapGroup
        .append("path")
        .datum(graticule)
        .attr("d", pathGenerator as any)
        .style("fill", "none")
        .style("stroke", GRATICULE_STROKE)
        .style("stroke-width", 0.8)
        .style("opacity", 0.8);

      // Neighboring world countries
      const worldFeatures = (worldData as any).features.filter((f: any) =>
        NEIGHBOR_NAMES.has(f.properties?.name),
      );

      const worldGroup = mapGroup.append("g").attr("class", "world-countries");

      worldGroup
        .selectAll("path")
        .data(worldFeatures)
        .enter()
        .append("path")
        .attr("d", pathGenerator as any)
        .style("fill", WORLD_COUNTRY_FILL)
        .style("stroke", WORLD_COUNTRY_STROKE)
        .style("stroke-width", 0.8)
        .style("opacity", 0.85)
        .style("cursor", "pointer")
        .style("transition", "fill 0.2s ease, stroke 0.2s ease")
        .on("mouseover", function (event, d: any) {
          if (isMobile) return;
          const rawName = d.properties?.name || "Láng giềng";
          const vnName = COUNTRY_NAME_VN[rawName] || rawName;

          d3.select(this)
            .style("fill", WORLD_COUNTRY_HOVER_FILL)
            .style("stroke", "#33557a")
            .style("stroke-width", 1.2);

          tooltip
            .html(
              `
            <div style="padding: 8px 12px;">
              <div style="font-weight: 700; font-size: 13px; color: #e2e8f0; margin-bottom: 2px;">${vnName}</div>
              ${rawName !== vnName ? `<div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">${rawName}</div>` : ""}
              <div style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; padding: 2px 7px; border-radius: 9999px; background: rgba(51, 65, 85, 0.5); color: #94a3b8; font-weight: 500;">
                Quốc gia láng giềng
              </div>
            </div>
          `,
            )
            .style("opacity", 1);

          moveTooltip(event);
        })
        .on("mousemove", (event) => {
          if (!isMobile) moveTooltip(event);
        })
        .on("mouseout", function () {
          d3.select(this)
            .style("fill", WORLD_COUNTRY_FILL)
            .style("stroke", WORLD_COUNTRY_STROKE)
            .style("stroke-width", 0.8);

          tooltip.style("opacity", 0);
        });

      // Ocean labels
      const oceanLabels = [
        {
          text: "BIỂN ĐÔNG",
          lon: 113.0,
          lat: 14.5,
          size: isMobile ? "12px" : "15px",
          weight: "700",
          spacing: "0.2em",
          fill: "#64748b",
        },
        {
          text: "Quần đảo Hoàng Sa",
          lon: 112.2,
          lat: 16.5,
          size: isMobile ? "9px" : "11px",
          weight: "600",
          spacing: "0.05em",
          fill: "#475569",
        },
        {
          text: "Quần đảo Trường Sa",
          lon: 114.2,
          lat: 9.8,
          size: isMobile ? "9px" : "11px",
          weight: "600",
          spacing: "0.05em",
          fill: "#475569",
        },
        {
          text: "Vịnh Bắc Bộ",
          lon: 107.5,
          lat: 19.8,
          size: isMobile ? "9px" : "11px",
          weight: "600",
          spacing: "0.05em",
          fill: "#475569",
        },
        {
          text: "Vịnh Thái Lan",
          lon: 101.5,
          lat: 9.5,
          size: isMobile ? "9px" : "11px",
          weight: "600",
          spacing: "0.05em",
          fill: "#475569",
        },
      ];

      oceanLabels.forEach((label) => {
        const pos = projection([label.lon, label.lat]);
        if (pos) {
          mapGroup
            .append("text")
            .attr("x", pos[0])
            .attr("y", pos[1])
            .text(label.text)
            .style("fill", label.fill)
            .style("font-size", label.size)
            .style("font-weight", label.weight)
            .style("letter-spacing", label.spacing)
            .style("text-anchor", "middle")
            .style("pointer-events", "none")
            .style("user-select", "none")
            .style("font-family", "var(--font-satoshi), system-ui, sans-serif");
        }
      });

      // Hover Tooltip attached to body (primarily desktop)
      const tooltip = d3
        .select("body")
        .append("div")
        .attr("class", "vn-map-tooltip")
        .style("position", "absolute")
        .style("background", TOOLTIP_BG)
        .style("color", "#ffffff")
        .style("padding", "0px")
        .style("border", `1px solid ${TOOLTIP_BORDER}`)
        .style("border-radius", "12px")
        .style("font-family", "var(--font-satoshi), system-ui, sans-serif")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .style("z-index", 1000)
        .style("box-shadow", "0 16px 36px -8px rgba(0, 0, 0, 0.85)")
        .style("transition", "opacity 0.15s ease");

      const moveTooltip = (e: MouseEvent) => {
        const tooltipNode = tooltip.node();
        const tooltipWidth = tooltipNode ? tooltipNode.clientWidth : 240;
        const tooltipHeight = tooltipNode ? tooltipNode.clientHeight : 160;

        let left = e.pageX + 16;
        let top = e.pageY - 16;

        if (left + tooltipWidth > window.innerWidth - 16) {
          left = e.pageX - tooltipWidth - 16;
        }
        if (top + tooltipHeight > window.innerHeight - 16) {
          top = e.pageY - tooltipHeight - 16;
        }

        tooltip.style("left", `${left}px`).style("top", `${top}px`);
      };

      // Province Paths
      const provincePaths = mapGroup
        .append("g")
        .attr("class", "provinces")
        .selectAll("path")
        .data(features)
        .enter()
        .append("path")
        .attr("d", pathGenerator as any)
        .style("cursor", "pointer")
        .style("stroke", PROVINCE_STROKE)
        .style("stroke-width", 1.2)
        .style(
          "transition",
          "fill 0.2s ease, stroke 0.2s ease, filter 0.2s ease",
        );

      const updateMapColors = () => {
        const visitedArray = visited();
        const activeSel = selectedProvince();
        provincePaths.each(function (d: any) {
          const name = d.properties.Name;
          const isVisited = visitedArray.includes(name);
          const isSelected = activeSel && activeSel.name === name;

          d3.select(this)
            .style(
              "fill",
              isSelected
                ? "var(--primary-400)"
                : isVisited
                  ? "var(--primary-500)"
                  : PROVINCE_DEFAULT_FILL,
            )
            .style(
              "stroke",
              isSelected
                ? "#ffffff"
                : isVisited
                  ? "var(--primary-300)"
                  : PROVINCE_STROKE,
            )
            .style("stroke-width", isSelected ? 2.5 : isVisited ? 1.4 : 1.2)
            .style("opacity", isVisited || isSelected ? 0.98 : 0.9)
            .style(
              "filter",
              isVisited || isSelected ? "url(#visited-glow)" : "none",
            );
        });
        updateBeacons();
      };

      provincePaths
        .on("click", function (event, d: any) {
          event.stopPropagation();
          const name = d.properties.Name;
          const info = PROVINCE_MAP[name] || { vi: name, region: "Việt Nam" };
          const isVisited = visited().includes(name);

          setSelectedProvince({ name, info, isVisited });
          tooltip.style("opacity", 0);
          updateMapColors();
        })
        .on("mouseover", function (event, d: any) {
          if (isMobile) return;
          const name = d.properties.Name;
          const info = PROVINCE_MAP[name] || { vi: name, region: "Việt Nam" };
          const isVisited = visited().includes(name);

          d3.select(this)
            .style(
              "fill",
              isVisited ? "var(--primary-400)" : PROVINCE_HOVER_FILL,
            )
            .style("stroke", "var(--primary-400)")
            .style("stroke-width", 2.2)
            .style("opacity", 1);

          if (info.coverImage) {
            tooltip
              .html(
                `
              <div style="width: 260px; overflow: hidden; border-radius: 12px; background: #0c131d;">
                <div style="position: relative; width: 100%; height: 130px; overflow: hidden;">
                  <img src="${info.coverImage}" alt="${info.vi}" style="width: 100%; height: 100%; object-fit: cover;" />
                  <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(12, 19, 29, 0.95) 0%, rgba(12, 19, 29, 0.3) 60%, transparent 100%);"></div>
                  ${
                    isVisited
                      ? `<span style="position: absolute; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-family: var(--font-mono), monospace; font-weight: 600; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 6px; background: rgba(12, 19, 29, 0.85); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.35); backdrop-filter: blur(8px);">
                          <span style="width: 5px; height: 5px; border-radius: 50%; background: #34d399;"></span>
                          ĐÃ GHÉ THĂM
                        </span>`
                      : `<span style="position: absolute; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-family: var(--font-mono), monospace; font-weight: 500; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 6px; background: rgba(12, 19, 29, 0.85); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); backdrop-filter: blur(8px);">
                          <span style="width: 5px; height: 5px; border-radius: 50%; background: #64748b;"></span>
                          CHƯA GHÉ THĂM
                        </span>`
                  }
                  <div style="position: absolute; bottom: 8px; left: 12px; right: 12px;">
                    <div style="font-weight: 800; font-size: 15px; color: #ffffff; text-shadow: 0 1px 4px rgba(0,0,0,0.6);">${info.vi}</div>
                    <div style="font-size: 11px; color: #cbd5e1; font-weight: 500;">${info.region}</div>
                  </div>
                </div>
                <div style="padding: 10px 12px 12px 12px;">
                  <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--primary-400); margin-bottom: 6px;">${isVisited ? "Bộ sưu tập hành trình" : "Điểm nổi bật"}</div>
                  <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    ${(info.highlights || [])
                      .map(
                        (h) =>
                          `<span style="font-size: 10px; background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(51, 65, 85, 0.8); color: #e2e8f0; padding: 2px 7px; border-radius: 6px; font-weight: 500;">${h}</span>`,
                      )
                      .join("")}
                  </div>
                  ${
                    isVisited && info.travelDate
                      ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 8px; font-style: italic;">${info.travelDate}</div>`
                      : ""
                  }
                </div>
              </div>
            `,
              )
              .style("opacity", 1);
          } else {
            tooltip
              .html(
                `
              <div style="padding: 10px 14px;">
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px; color: #ffffff;">${info.vi}</div>
                <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">${info.region}</div>
                <div style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: rgba(148, 163, 184, 0.12); color: #cbd5e1; font-weight: 600;">
                  <span style="width: 5px; height: 5px; border-radius: 50%; background: #64748b;"></span>
                  Chưa ghé thăm
                </div>
              </div>
            `,
              )
              .style("opacity", 1);
          }

          moveTooltip(event);
        })
        .on("mousemove", (event) => {
          if (!isMobile) moveTooltip(event);
        })
        .on("mouseout", function (_event, d: any) {
          if (isMobile) return;
          const name = d.properties.Name;
          const isVisited = visited().includes(name);
          const activeSel = selectedProvince();
          const isSelected = activeSel && activeSel.name === name;

          d3.select(this)
            .style(
              "fill",
              isSelected
                ? "var(--primary-400)"
                : isVisited
                  ? "var(--primary-500)"
                  : PROVINCE_DEFAULT_FILL,
            )
            .style(
              "stroke",
              isSelected
                ? "#ffffff"
                : isVisited
                  ? "var(--primary-300)"
                  : PROVINCE_STROKE,
            )
            .style("stroke-width", isSelected ? 2.5 : isVisited ? 1.4 : 1.2)
            .style("opacity", isVisited || isSelected ? 0.98 : 0.9)
            .style(
              "filter",
              isVisited || isSelected ? "url(#visited-glow)" : "none",
            );

          tooltip.style("opacity", 0);
        });

      // Beacon markers group
      const beaconGroup = mapGroup.append("g").attr("class", "beacons");

      const updateBeacons = () => {
        beaconGroup.selectAll("*").remove();
        const visitedArray = visited();

        features.forEach((feature: any) => {
          const name = feature.properties.Name;
          if (visitedArray.includes(name)) {
            const info = PROVINCE_MAP[name] || { vi: name, region: "Việt Nam" };
            const centroid = d3.geoCentroid(feature);
            const coords = projection(centroid);
            if (!coords) return;

            const g = beaconGroup
              .append("g")
              .attr("transform", `translate(${coords[0]}, ${coords[1]})`);

            g.append("circle")
              .attr("r", isMobile ? 3.5 : 4)
              .attr("fill", "#ffffff")
              .attr("stroke", "var(--primary-500)")
              .attr("stroke-width", isMobile ? 2 : 2.5);

            const dx = info.labelDx ?? (isMobile ? 12 : 18);
            const dy = info.labelDy ?? 4;
            g.append("text")
              .attr("x", dx)
              .attr("y", dy)
              .text(info.vi)
              .style("fill", "#ffffff")
              .style("stroke", "#0d1b2a")
              .style("stroke-width", "3.5px")
              .style("paint-order", "stroke fill")
              .style("font-size", isMobile ? "10px" : "11.5px")
              .style("font-weight", "700")
              .style(
                "font-family",
                "var(--font-satoshi), system-ui, -apple-system, sans-serif",
              )
              .style("letter-spacing", "0.01em")
              .style("pointer-events", "none");
          }
        });
      };

      updateMapColors();

      // Zoom behavior
      zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.8, 12])
        .on("zoom", (event) => {
          mapGroup.attr("transform", event.transform);
          updateTiles(event.transform);
        });

      svg.call(zoomBehavior as any);
    };

    renderMap();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderMap();
      }, 250);
    });

    resizeObserver.observe(containerRef);

    onCleanup(() => {
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      d3.select("body").selectAll(".vn-map-tooltip").remove();
    });
  });

  const totalProvinces = Object.keys(PROVINCE_MAP).length;
  const visitedCount = createMemo(() => visited().length);
  const visitedPercent = createMemo(() =>
    ((visitedCount() / totalProvinces) * 100).toFixed(1),
  );

  const regionCounts = createMemo(() => {
    let bac = 0;
    let trung = 0;
    let nam = 0;
    visited().forEach((provName) => {
      const info = PROVINCE_MAP[provName];
      if (!info) return;
      const r = info.region;
      if (r.includes("Bắc") || r.includes("Hồng")) bac++;
      else if (r.includes("Trung") || r.includes("Nguyên")) trung++;
      else if (r.includes("Nam")) nam++;
    });
    return { bac, trung, nam };
  });

  return (
    <div class="visit-map-shell relative w-full h-screen overflow-hidden text-white bg-[#0a131d] select-none touch-none">
      {/* Map Container */}
      <div
        ref={containerRef}
        class="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Zoom & Center Controls */}
      <div class="absolute top-20 right-4 sm:top-24 sm:right-6 z-40 flex flex-col gap-1.5 bg-darkslate-800/90 backdrop-blur-md border border-darkslate-500/80 rounded-xl p-1 shadow-lg">
        <button
          type="button"
          onClick={handleZoomIn}
          class="w-9 h-9 flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-darkslate-600/80 active:scale-95 transition-all"
          aria-label="Phóng to"
          title="Phóng to"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
        <div class="h-px bg-darkslate-600/60 mx-1" />
        <button
          type="button"
          onClick={handleZoomOut}
          class="w-9 h-9 flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-darkslate-600/80 active:scale-95 transition-all"
          aria-label="Thu nhỏ"
          title="Thu nhỏ"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19.5 12h-15"
            />
          </svg>
        </button>
        <div class="h-px bg-darkslate-600/60 mx-1" />
        <button
          type="button"
          onClick={handleResetZoom}
          class="w-9 h-9 flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-darkslate-600/80 active:scale-95 transition-all"
          aria-label="Đặt lại góc nhìn"
          title="Đặt lại góc nhìn"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
        </button>
      </div>

      {/* Selected Province Floating Drawer / Card */}
      {selectedProvince() && (
        <div class="absolute bottom-4 left-4 right-4 sm:left-6 sm:bottom-6 sm:right-auto z-50 w-auto sm:w-80 rounded-2xl bg-darkslate-800/95 backdrop-blur-2xl border border-darkslate-500/90 shadow-2xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          <div class="relative">
            {selectedProvince()!.info.coverImage ? (
              <div class="relative w-full h-36 overflow-hidden">
                <img
                  src={selectedProvince()!.info.coverImage}
                  alt={selectedProvince()!.info.vi}
                  class="w-full h-full object-cover"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-darkslate-800 via-darkslate-800/40 to-transparent" />
              </div>
            ) : (
              <div class="w-full h-10 bg-darkslate-700/40" />
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedProvince(null)}
              class="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full bg-darkslate-900/80 hover:bg-darkslate-900 text-slate-300 hover:text-white border border-darkslate-600 transition-all z-10"
              aria-label="Đóng"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Title & Status */}
            <div
              class={`px-4 ${selectedProvince()!.info.coverImage ? "-mt-8 relative z-10" : "pt-1"}`}
            >
              <div class="flex items-center gap-2 mb-1.5">
                {selectedProvince()!.isVisited ? (
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-semibold tracking-wider bg-darkslate-900/85 text-emerald-300 border border-emerald-500/35 backdrop-blur-md">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    ĐÃ GHÉ THĂM
                  </span>
                ) : (
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-medium tracking-wider bg-darkslate-900/85 text-slate-400 border border-white/10 backdrop-blur-md">
                    <span class="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    CHƯA GHÉ THĂM
                  </span>
                )}
              </div>
              <h3 class="text-xl font-extrabold text-white tracking-tight font-cabinet">
                {selectedProvince()!.info.vi}
              </h3>
              <p class="text-xs text-slate-300 font-medium">
                {selectedProvince()!.info.region}
              </p>
            </div>
          </div>

          {/* Highlights & Details */}
          <div class="p-4 pt-3">
            {selectedProvince()!.info.highlights && (
              <div class="mb-3">
                <div class="text-[10px] font-bold uppercase tracking-wider text-primary-400 mb-1.5">
                  Bộ sưu tập hành trình
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {selectedProvince()!.info.highlights!.map((item) => (
                    <span class="text-xs bg-darkslate-900/90 border border-darkslate-600/80 text-slate-200 px-2.5 py-1 rounded-md font-medium">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedProvince()!.info.travelDate && (
              <div class="text-xs text-slate-400 italic">
                {selectedProvince()!.info.travelDate}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Minimal Data Statistics Card (Bottom-Right) */}
      <div
        class={`absolute bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-40 w-auto sm:w-80 rounded-2xl bg-darkslate-800/95 backdrop-blur-2xl border border-darkslate-500/80 shadow-2xl text-white transition-all duration-300 ${
          selectedProvince() ? "hidden sm:block" : "block"
        } ${isStatsCollapsed() ? "p-3" : "p-3.5 sm:p-5"}`}
      >
        {/* Header */}
        <div class="flex items-center justify-between pb-2 sm:pb-3 border-b border-darkslate-600/60 mb-3 sm:mb-4">
          <span class="text-xs font-mono font-bold tracking-widest text-slate-200 uppercase">
            <span class="visit-map-stats-label">BẢN ĐỒ VIỆT NAM</span>
          </span>
          <button
            type="button"
            onClick={() => setIsStatsCollapsed(!isStatsCollapsed())}
            class="sm:hidden p-1 rounded-lg bg-darkslate-700/80 text-slate-300 hover:text-white"
            aria-label={isStatsCollapsed() ? "Mở rộng" : "Thu gọn"}
          >
            <svg
              class={`w-4 h-4 transition-transform duration-200 ${isStatsCollapsed() ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19.5 8.25l-7.5 7.5-7.5-7.5"
              />
            </svg>
          </button>
        </div>

        {/* Collapsed View on Mobile */}
        {isStatsCollapsed() ? (
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-baseline gap-1.5">
              <span class="text-lg font-extrabold text-white font-cabinet">
                {visitedCount()}
              </span>
              <span class="visit-map-stat-denominator text-xs text-slate-300">
                / {totalProvinces} tỉnh thành
              </span>
            </div>
            <span class="text-sm font-extrabold text-primary-400 font-cabinet">
              {visitedPercent()}%
            </span>
          </div>
        ) : (
          /* Full View */
          <>
            {/* Main Stats Counter */}
            <div class="flex items-center justify-between mb-3">
              <div>
                <div class="flex items-baseline gap-1.5">
                  <span class="text-4xl font-extrabold text-white tracking-tight font-cabinet">
                    {visitedCount()}
                  </span>
                  <span class="visit-map-stat-denominator text-xl font-bold text-slate-300">
                    / {totalProvinces}
                  </span>
                </div>
                <div class="visit-map-stat-caption text-xs text-slate-200 font-medium mt-1">
                  Tỉnh thành đã khám phá
                </div>
              </div>

              <div class="text-2xl font-extrabold text-primary-400 font-cabinet tracking-tight">
                {visitedPercent()}%
              </div>
            </div>

            {/* Progress Bar */}
            <div class="w-full h-2 bg-darkslate-900/90 rounded-full overflow-hidden border border-darkslate-600/60 mb-4">
              <div
                class="bg-primary-500 h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${visitedPercent()}%` }}
              />
            </div>

            {/* Region Breakdown Grid */}
            <div class="grid grid-cols-3 gap-2.5 text-center">
              <div class="bg-darkslate-900/80 border border-darkslate-600/60 rounded-xl p-2 sm:p-2.5 flex flex-col items-center">
                <span class="text-[10px] sm:text-[11px] font-bold text-slate-200 uppercase tracking-wider mb-0.5 sm:mb-1">
                  Bắc Bộ
                </span>
                <span class="text-sm sm:text-base font-extrabold text-white">
                  {regionCounts().bac}{" "}
                  <span class="text-xs font-semibold text-slate-300">tỉnh</span>
                </span>
              </div>
              <div class="bg-darkslate-900/80 border border-darkslate-600/60 rounded-xl p-2 sm:p-2.5 flex flex-col items-center">
                <span class="text-[10px] sm:text-[11px] font-bold text-slate-200 uppercase tracking-wider mb-0.5 sm:mb-1">
                  Trung Bộ
                </span>
                <span class="text-sm sm:text-base font-extrabold text-white">
                  {regionCounts().trung}{" "}
                  <span class="text-xs font-semibold text-slate-300">tỉnh</span>
                </span>
              </div>
              <div class="bg-darkslate-900/80 border border-darkslate-600/60 rounded-xl p-2 sm:p-2.5 flex flex-col items-center">
                <span class="text-[10px] sm:text-[11px] font-bold text-slate-200 uppercase tracking-wider mb-0.5 sm:mb-1">
                  Nam Bộ
                </span>
                <span class="text-sm sm:text-base font-extrabold text-white">
                  {regionCounts().nam}{" "}
                  <span class="text-xs font-semibold text-slate-300">tỉnh</span>
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Basemap Attribution */}
      <div class="absolute bottom-2 left-3 z-10 text-[10px] text-slate-500/80 pointer-events-auto select-none flex items-center gap-1 font-mono">
        <span>©</span>
        <a
          href="https://carto.com/attributions"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-slate-400 underline decoration-slate-600/50"
        >
          CARTO
        </a>
        <span>•</span>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-slate-400 underline decoration-slate-600/50"
        >
          OpenStreetMap
        </a>
      </div>
    </div>
  );
}
