import { PrismaClient, SettingValueType, JewelleryKind, AssetType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true },
  { code: 'ADMIN', name: 'Admin', isSystem: true },
  { code: 'EDITOR', name: 'Editor', isSystem: true },
  { code: 'CUSTOMER', name: 'Customer', isSystem: true },
] as const;

const PERMISSIONS: Array<{ code: string; module: string; description: string }> = [
  { code: 'products:read', module: 'products', description: 'Read products' },
  { code: 'products:write', module: 'products', description: 'Write products' },
  { code: 'products:publish', module: 'products', description: 'Publish products' },
  { code: 'categories:write', module: 'categories', description: 'Manage categories' },
  { code: 'assets:write', module: 'assets', description: 'Manage jewellery assets' },
  { code: 'users:read', module: 'users', description: 'Read users' },
  { code: 'users:write', module: 'users', description: 'Write users' },
  { code: 'roles:write', module: 'roles', description: 'Assign roles' },
  { code: 'settings:write', module: 'settings', description: 'Manage settings' },
  { code: 'analytics:read', module: 'analytics', description: 'View analytics' },
  { code: 'audit:read', module: 'audit', description: 'View audit logs' },
  { code: 'captures:read', module: 'captures', description: 'Read captures' },
  { code: 'captures:delete', module: 'captures', description: 'Delete captures' },
];

const STAFF_PERMS = PERMISSIONS.map((p) => p.code);
const EDITOR_PERMS = [
  'products:read',
  'products:write',
  'products:publish',
  'categories:write',
  'assets:write',
  'analytics:read',
];

const prisma = new PrismaClient();

async function main() {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      create: perm,
      update: { module: perm.module, description: perm.description },
    });
  }

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: { ...role, description: role.name },
      update: { name: role.name, isSystem: true },
    });
  }

  const allRoles = await prisma.role.findMany();
  const allPerms = await prisma.permission.findMany();
  const permByCode = Object.fromEntries(allPerms.map((p) => [p.code, p.id]));
  const roleByCode = Object.fromEntries(allRoles.map((r) => [r.code, r.id]));

  async function link(roleCode: string, codes: string[]) {
    const roleId = roleByCode[roleCode]!;
    for (const code of codes) {
      const permissionId = permByCode[code]!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        create: { roleId, permissionId },
        update: {},
      });
    }
  }

  await link('SUPER_ADMIN', STAFF_PERMS);
  await link('ADMIN', STAFF_PERMS);
  await link('EDITOR', EDITOR_PERMS);

  const passwordHash = await bcrypt.hash('Admin@12345', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@vj.local' },
    create: {
      email: 'admin@vj.local',
      fullName: 'Platform Admin',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      roles: { create: [{ roleId: roleByCode['SUPER_ADMIN']! }] },
    },
    update: { passwordHash, status: 'ACTIVE' },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: admin.id, roleId: roleByCode['SUPER_ADMIN']! },
    },
    create: { userId: admin.id, roleId: roleByCode['SUPER_ADMIN']! },
    update: {},
  });

  // Seed Categories
  const categoriesData = [
    { slug: 'earrings', name: 'Earrings', description: 'Fine drop, hoop, and stud earrings for virtual try-on', sortOrder: 1 },
    { slug: 'necklaces', name: 'Necklaces', description: 'Royal chokers and diamond pendants with collarbone alignment', sortOrder: 2 },
    { slug: 'nose-rings', name: 'Nose Rings', description: 'Precision nostril studs and septum rings', sortOrder: 3 },
    { slug: 'rings', name: 'Rings', description: 'Solitaire and bridal eternity rings with hand tracking', sortOrder: 4 },
    { slug: 'bangles', name: 'Bangles & Bracelets', description: 'Traditional kadas and tennis bracelets with wrist alignment', sortOrder: 5 },
  ];

  const categoryMap: Record<string, string> = {};
  for (const cat of categoriesData) {
    const created = await prisma.category.upsert({
      where: { slug: cat.slug },
      create: { ...cat, isActive: true },
      update: { name: cat.name, description: cat.description, sortOrder: cat.sortOrder, isActive: true },
    });
    categoryMap[cat.slug] = created.id;
  }

  // Demo products (at least 2 per category, zero rectangular photos)
  const catalogueItems = [
    // ── Earrings ────────────────────────────────────────────────────────────
    {
      sku: 'VJ-EAR-001',
      name: 'Celestial Solitaire Drop Earrings',
      slug: 'celestial-solitaire-drop-earrings',
      categorySlug: 'earrings',
      description: 'Handcrafted 22k yellow gold drop earrings crowned with bezel-set teardrop gems.',
      jewelleryKind: JewelleryKind.EARRINGS,
      priceCents: 1299900,
      currency: 'INR',
      assetType: AssetType.MODEL_GLB,
      assetUrl: 'procedural://earring',
      previewUrl: 'http://localhost:3000/assets/earrings-drop.svg',
      anchorProfile: { anchorType: 'EAR_LOBE', earSide: 'BOTH' },
      defaultScale: 1.0,
      defaultRotationZ: 0,
      mirrorForOppositeEar: true,
      fingerIndex: null,
    },
    {
      sku: 'VJ-EAR-002',
      name: 'Heritage Diamond Solitaire Studs',
      slug: 'heritage-diamond-solitaire-studs',
      categorySlug: 'earrings',
      description: 'Classic 4-prong brilliant-cut diamond studs set in polished white gold.',
      jewelleryKind: JewelleryKind.EARRINGS,
      priceCents: 899900,
      currency: 'INR',
      assetType: AssetType.IMAGE_OVERLAY,
      assetUrl: 'http://localhost:3000/assets/earrings-stud.svg',
      previewUrl: 'http://localhost:3000/assets/earrings-stud.svg',
      anchorProfile: { anchorType: 'EAR_LOBE', earSide: 'BOTH' },
      defaultScale: 0.8,
      defaultRotationZ: 0,
      mirrorForOppositeEar: true,
      fingerIndex: null,
    },

    // ── Necklaces ───────────────────────────────────────────────────────────
    {
      sku: 'VJ-NECK-001',
      name: 'Royal Empress Emerald Choker',
      slug: 'royal-empress-emerald-choker',
      categorySlug: 'necklaces',
      description: 'Grand royal choker with graduated gold torque bands and a central faceted emerald drop.',
      jewelleryKind: JewelleryKind.NECKLACE,
      priceCents: 3499900,
      currency: 'INR',
      assetType: AssetType.MODEL_GLB,
      assetUrl: 'procedural://necklace',
      previewUrl: 'http://localhost:3000/assets/necklace-choker.svg',
      anchorProfile: { anchorType: 'NECK_BASE' },
      defaultScale: 1.0,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },
    {
      sku: 'VJ-NECK-002',
      name: 'Aura Solitaire Clavicle Pendant',
      slug: 'aura-solitaire-clavicle-pendant',
      categorySlug: 'necklaces',
      description: 'Subtle 18k delicate gold chain suspending a floating teardrop diamond pendant.',
      jewelleryKind: JewelleryKind.NECKLACE,
      priceCents: 1899900,
      currency: 'INR',
      assetType: AssetType.IMAGE_OVERLAY,
      assetUrl: 'http://localhost:3000/assets/necklace-pendant.svg',
      previewUrl: 'http://localhost:3000/assets/necklace-pendant.svg',
      anchorProfile: { anchorType: 'NECK_BASE' },
      defaultScale: 1.1,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },

    // ── Nose Rings ──────────────────────────────────────────────────────────
    {
      sku: 'VJ-NOSE-001',
      name: 'Noor Diamond Septum Ring',
      slug: 'noor-diamond-septum-ring',
      categorySlug: 'nose-rings',
      description: 'Handcrafted polished gold septum ring adorned with micro-pavé diamonds.',
      jewelleryKind: JewelleryKind.NOSE_RING,
      priceCents: 699900,
      currency: 'INR',
      assetType: AssetType.MODEL_GLB,
      assetUrl: 'procedural://nose_ring',
      previewUrl: 'http://localhost:3000/assets/nosering-septum.svg',
      anchorProfile: { anchorType: 'NOSE_WING', side: 'LEFT' },
      defaultScale: 0.7,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },
    {
      sku: 'VJ-NOSE-002',
      name: 'Aethel Gold Nostril Stud',
      slug: 'aethel-gold-nostril-stud',
      categorySlug: 'nose-rings',
      description: 'Traditional bezel-set floral diamond nose pin with 22k gold ball backing.',
      jewelleryKind: JewelleryKind.NOSE_RING,
      priceCents: 499900,
      currency: 'INR',
      assetType: AssetType.IMAGE_OVERLAY,
      assetUrl: 'http://localhost:3000/assets/nosering-stud.svg',
      previewUrl: 'http://localhost:3000/assets/nosering-stud.svg',
      anchorProfile: { anchorType: 'NOSE_WING', side: 'LEFT' },
      defaultScale: 0.6,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },

    // ── Rings ───────────────────────────────────────────────────────────────
    {
      sku: 'VJ-RING-001',
      name: 'Eternal Pavé Solitaire Ring',
      slug: 'eternal-pave-solitaire-ring',
      categorySlug: 'rings',
      description: 'Certified 1.5 carat round brilliant diamond raised on a pavé-encrusted gold shank.',
      jewelleryKind: JewelleryKind.RINGS,
      priceCents: 2199900,
      currency: 'INR',
      assetType: AssetType.MODEL_GLB,
      assetUrl: 'procedural://ring',
      previewUrl: 'http://localhost:3000/assets/ring-solitaire.svg',
      anchorProfile: { anchorType: 'FINGER_BASE', fingerIndex: 3 },
      defaultScale: 1.0,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: 3,
    },
    {
      sku: 'VJ-RING-002',
      name: 'Lumière Platinum Wedding Band',
      slug: 'lumiere-platinum-wedding-band',
      categorySlug: 'rings',
      description: 'Comfort-fit solid platinum court band with satin center and high-polish bevels.',
      jewelleryKind: JewelleryKind.RINGS,
      priceCents: 1599900,
      currency: 'INR',
      assetType: AssetType.IMAGE_OVERLAY,
      assetUrl: 'http://localhost:3000/assets/ring-band.svg',
      previewUrl: 'http://localhost:3000/assets/ring-band.svg',
      anchorProfile: { anchorType: 'FINGER_BASE', fingerIndex: 3 },
      defaultScale: 0.9,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: 3,
    },

    // ── Bangles ─────────────────────────────────────────────────────────────
    {
      sku: 'VJ-BANGLE-001',
      name: 'Dynasty Filigree Gold Kada',
      slug: 'dynasty-filigree-gold-kada',
      categorySlug: 'bangles',
      description: 'Heritage temple jewellery 22k gold open kada with embossed lion finials.',
      jewelleryKind: JewelleryKind.BANGLES,
      priceCents: 4599900,
      currency: 'INR',
      assetType: AssetType.MODEL_GLB,
      assetUrl: 'procedural://bangle',
      previewUrl: 'http://localhost:3000/assets/bangle-kada.svg',
      anchorProfile: { anchorType: 'WRIST' },
      defaultScale: 1.2,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },
    {
      sku: 'VJ-BANGLE-002',
      name: 'Starlight Diamond Tennis Bracelet',
      slug: 'starlight-diamond-tennis-bracelet',
      categorySlug: 'bangles',
      description: 'Continuous line of brilliant-cut diamonds articulated in 18k white gold.',
      jewelleryKind: JewelleryKind.BANGLES,
      priceCents: 2999900,
      currency: 'INR',
      assetType: AssetType.IMAGE_OVERLAY,
      assetUrl: 'http://localhost:3000/assets/bangle-cuff.svg',
      previewUrl: 'http://localhost:3000/assets/bangle-cuff.svg',
      anchorProfile: { anchorType: 'WRIST' },
      defaultScale: 1.1,
      defaultRotationZ: 0,
      mirrorForOppositeEar: false,
      fingerIndex: null,
    },
  ];

  for (const item of catalogueItems) {
    const categoryId = categoryMap[item.categorySlug];
    if (!categoryId) continue;

    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      create: {
        categoryId,
        sku: item.sku,
        name: item.name,
        slug: item.slug,
        description: item.description,
        jewelleryKind: item.jewelleryKind,
        status: 'PUBLISHED',
        priceCents: item.priceCents,
        currency: item.currency,
        publishedAt: new Date(),
      },
      update: {
        categoryId,
        name: item.name,
        slug: item.slug,
        description: item.description,
        jewelleryKind: item.jewelleryKind,
        status: 'PUBLISHED',
        priceCents: item.priceCents,
        currency: item.currency,
        publishedAt: new Date(),
      },
    });

    // Primary product thumbnail
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({
      data: {
        productId: product.id,
        storageKey: `catalogue/${item.sku}/primary.svg`,
        url: item.previewUrl,
        altText: item.name,
        isPrimary: true,
        sortOrder: 0,
      },
    });

    // Active Try-On Asset
    await prisma.jewelleryAsset.deleteMany({ where: { productId: product.id } });
    await prisma.jewelleryAsset.create({
      data: {
        productId: product.id,
        kind: item.jewelleryKind,
        assetType: item.assetType,
        storageKey: `catalogue/${item.sku}/asset`,
        url: item.assetUrl,
        anchorProfile: item.anchorProfile,
        defaultScale: item.defaultScale,
        defaultRotationZ: item.defaultRotationZ,
        mirrorForOppositeEar: item.mirrorForOppositeEar,
        fingerIndex: item.fingerIndex,
        isActive: true,
      },
    });
  }

  await prisma.setting.upsert({
    where: { key: 'tryon.guestEnabled' },
    create: {
      key: 'tryon.guestEnabled',
      value: true,
      valueType: SettingValueType.BOOLEAN,
      isPublic: true,
      description: 'Allow guest try-on sessions',
    },
    update: { value: true, isPublic: true },
  });

  await prisma.setting.upsert({
    where: { key: 'tryon.maxSessionMinutes' },
    create: {
      key: 'tryon.maxSessionMinutes',
      value: 30,
      valueType: SettingValueType.NUMBER,
      isPublic: true,
      description: 'Max try-on session duration',
    },
    update: { value: 30, isPublic: true },
  });

  console.log('Seed completed successfully with 5 categories and 10 production assets.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
