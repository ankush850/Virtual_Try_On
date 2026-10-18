'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AssetType, AnchorType } from '@vj/shared';
import {
  Upload,
  Sparkles,
  CheckCircle2,
  Box,
  Sliders,
  Eye,
  FileCode,
  Info,
  Loader2,
  Trash2,
  FileCheck,
} from 'lucide-react';
import { AdminShell } from '@/components/layout/admin-shell';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vj/ui';
import { api } from '@/lib/api';

const ALLOWED_EXTENSIONS = ['.glb', '.gltf', '.png', '.webp'];
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export default function AdminUploadJewelleryPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productId, setProductId] = useState('');
  const [assetType, setAssetType] = useState<AssetType>(AssetType.MODEL_3D);
  const [anchorType, setAnchorType] = useState<AnchorType>(AnchorType.EAR_LOBE);
  const [assetUrl, setAssetUrl] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: number;
    mimeType: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [defaultScale, setDefaultScale] = useState('1.0');
  const [defaultRotationZ, setDefaultRotationZ] = useState('0');
  const [mirrorForOppositeEar, setMirrorForOppositeEar] = useState(true);
  const [fingerIndex, setFingerIndex] = useState('3'); // Ring finger default

  // Load products list to associate asset
  const productsQuery = useQuery({
    queryKey: ['admin', 'products', 'for-assets'],
    queryFn: () => api.catalog.listProducts({ pageSize: 100 }),
  });

  const handleFileUpload = async (file: File) => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`Unsupported format "${ext}". Supported formats: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      toast.error(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds 25 MB limit.`);
      return;
    }

    setIsUploading(true);
    try {
      const res = await api.admin.uploadAssetFile(file);
      setStorageKey(res.storageKey);
      setAssetUrl(res.url);
      setUploadedFile({
        name: file.name,
        size: file.size,
        mimeType: res.mimeType,
      });

      if (ext === '.png' || ext === '.webp') {
        setAssetType(AssetType.IMAGE_2D);
      } else {
        setAssetType(AssetType.MODEL_3D);
      }

      toast.success(`Uploaded ${file.name} successfully`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Asset upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setStorageKey('');
    setAssetUrl('');
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadAssetMutation = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error('Please select a piece from your catalogue');
      if (!assetUrl.trim() && !storageKey) {
        throw new Error('Please upload an AR asset file (.glb, .gltf, .png, .webp) or provide a model URL');
      }

      // Ensure storageKey is never empty
      const effectiveStorageKey =
        storageKey ||
        (assetUrl.startsWith('http')
          ? `external/${encodeURIComponent(assetUrl)}`
          : `procedural/${anchorType.toLowerCase()}`);

      const body = {
        assetType,
        storageKey: effectiveStorageKey,
        url: assetUrl.trim(),
        anchorProfile: {
          anchorType,
          earSide: 'BOTH',
          fingerIndex: anchorType === AnchorType.FINGER_BASE ? parseInt(fingerIndex, 10) : undefined,
        },
        defaultScale: parseFloat(defaultScale) || 1.0,
        defaultRotationZ: parseFloat(defaultRotationZ) || 0,
        mirrorForOppositeEar,
        isActive: true,
      };

      return api.admin.createProductAsset(productId, body);
    },
    onSuccess: () => {
      toast.success('3D AR Asset calibrated and activated for product');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not bind AR asset');
    },
  });

  const products = productsQuery.data?.items ?? [];
  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <AdminShell title="Upload & Calibrate 3D Jewellery">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">3D AR Asset Studio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bind Three.js GLTF/GLB models or high-resolution 2D sprites to showroom pieces with sub-millimeter calibration.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              uploadAssetMutation.mutate();
            }}
            className="space-y-6"
          >
            {/* Step 1: Select Catalogue Piece */}
            <Card className="rounded-3xl border shadow-xs">
              <CardHeader>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Box className="h-4 w-4" />
                  <span>Step 1: Catalogue Association</span>
                </div>
                <CardTitle className="font-serif text-xl font-light">Select Showroom Piece</CardTitle>
                <CardDescription className="text-xs">
                  Choose the fine jewellery item this asset will be fitted onto in virtual try-on.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Target Catalogue Item *
                  </Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="rounded-xl text-xs">
                      <SelectValue placeholder="Choose a piece from inventory…" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.jewelleryKind.replace(/_/g, ' ')}) · SKU: {p.sku}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: 3D File Upload / URL */}
            <Card className="rounded-3xl border shadow-xs">
              <CardHeader>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Upload className="h-4 w-4" />
                  <span>Step 2: AR Jewellery Asset Upload</span>
                </div>
                <CardTitle className="font-serif text-xl font-light">Upload File or Provide URL</CardTitle>
                <CardDescription className="text-xs">
                  Upload a 3D GLTF (.glb, .gltf) or 2D transparent overlay (.png, .webp) up to 25MB.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* File Dropzone */}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".glb,.gltf,.png,.webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileUpload(file);
                  }}
                />

                {uploadedFile ? (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <FileCheck className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{uploadedFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {(uploadedFile.size / 1024).toFixed(1)} KB · {uploadedFile.mimeType}
                        </p>
                        {storageKey && (
                          <p className="text-[10px] font-mono text-muted-foreground/80 truncate max-w-[320px]">
                            Key: {storageKey}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs rounded-xl"
                      >
                        Replace
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleRemoveFile}
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-xl"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleFileUpload(file);
                    }}
                    className={`rounded-2xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                      isDragging
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/20 hover:border-primary/50'
                    }`}
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center py-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="mt-2 text-xs font-medium text-foreground">
                          Uploading asset to secure storage…
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Validating and hashing file</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="mt-2 text-xs font-medium text-foreground">
                          Drag & drop .glb, .gltf, .png, or .webp here, or click to browse
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Up to 25MB · Stored automatically in asset storage
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Asset Format *
                    </Label>
                    <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
                      <SelectTrigger className="rounded-xl text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AssetType.MODEL_3D}>3D Model (.GLB / .GLTF)</SelectItem>
                        <SelectItem value={AssetType.IMAGE_2D}>High-Res 2D Sprite (.PNG / .WEBP)</SelectItem>
                        <SelectItem value={AssetType.PROCEDURAL}>Procedural Three.js Mesh</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Anchor Target Profile *
                    </Label>
                    <Select value={anchorType} onValueChange={(v) => setAnchorType(v as AnchorType)}>
                      <SelectTrigger className="rounded-xl text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AnchorType.EAR_LOBE}>Earlobe (Earrings / Drops)</SelectItem>
                        <SelectItem value={AnchorType.NECK_BASE}>Neck Base (Chokers / Necklaces)</SelectItem>
                        <SelectItem value={AnchorType.FINGER_BASE}>Finger Base (Solitaire Rings)</SelectItem>
                        <SelectItem value={AnchorType.WRIST}>Wrist (Bracelets / Bangles)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="assetUrl" className="text-xs uppercase tracking-wider text-muted-foreground">
                    Model Storage URL / S3 Bucket Key *
                  </Label>
                  <Input
                    id="assetUrl"
                    value={assetUrl}
                    onChange={(e) => setAssetUrl(e.target.value)}
                    placeholder="Auto-filled on file upload or enter URL (e.g. procedural://earring)"
                    required
                    className="rounded-xl font-mono text-xs"
                  />
                  {storageKey && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      Attached storageKey: {storageKey}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Step 3: Spatial Calibration Sliders */}
            <Card className="rounded-3xl border shadow-xs">
              <CardHeader>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sliders className="h-4 w-4" />
                  <span>Step 3: AR Calibration & Alignment</span>
                </div>
                <CardTitle className="font-serif text-xl font-light">Fine-Tune Physical Proportions</CardTitle>
                <CardDescription className="text-xs">
                  Calibrate initial scale multiplier, angular rotation, and opposite side mirroring.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <Label htmlFor="scale" className="uppercase tracking-wider text-muted-foreground">
                        Scale Factor: {defaultScale}x
                      </Label>
                    </div>
                    <Input
                      id="scale"
                      type="range"
                      min="0.2"
                      max="3.0"
                      step="0.05"
                      value={defaultScale}
                      onChange={(e) => setDefaultScale(e.target.value)}
                      className="cursor-pointer"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <Label htmlFor="rotZ" className="uppercase tracking-wider text-muted-foreground">
                        Rotation Offset Z: {defaultRotationZ}°
                      </Label>
                    </div>
                    <Input
                      id="rotZ"
                      type="range"
                      min="-180"
                      max="180"
                      step="5"
                      value={defaultRotationZ}
                      onChange={(e) => setDefaultRotationZ(e.target.value)}
                      className="cursor-pointer"
                    />
                  </div>
                </div>

                {anchorType === AnchorType.EAR_LOBE && (
                  <div className="flex items-center gap-3 pt-2">
                    <input
                      type="checkbox"
                      id="mirrorEar"
                      checked={mirrorForOppositeEar}
                      onChange={(e) => setMirrorForOppositeEar(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                    <Label htmlFor="mirrorEar" className="text-xs text-foreground cursor-pointer">
                      Mirror geometry automatically for opposite earlobe (Bilateral Earring Pair)
                    </Label>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={uploadAssetMutation.isPending || isUploading || !productId}
                    className="w-full rounded-full py-6 text-sm font-medium shadow-md shadow-primary/20"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {uploadAssetMutation.isPending ? 'Activating Asset…' : 'Save & Activate Try-On Asset'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>

          {/* Right Column: Live Model Diagnostic Preview Card */}
          <aside className="space-y-6">
            <Card className="rounded-3xl border shadow-xs overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Eye className="h-4 w-4" />
                  <span>Preview & Diagnostics</span>
                </div>
                <CardTitle className="font-serif text-lg font-light">Asset Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {/* Simulated 3D Canvas Box */}
                <div className="relative aspect-square w-full rounded-2xl bg-black border border-white/10 flex flex-col items-center justify-center p-6 text-center text-white overflow-hidden">
                  <div className="relative flex items-center justify-center h-32 w-32 rounded-full border border-dashed border-primary/40 animate-[spin_15s_linear_infinite]">
                    <div className="absolute top-1 h-3 w-3 rounded-full bg-primary" />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-4">
                    <Box className="h-10 w-10 text-primary drop-shadow-[0_0_12px_rgba(212,175,55,0.7)] animate-pulse" />
                    <span className="mt-3 font-serif text-sm font-medium text-white">
                      {assetType === AssetType.IMAGE_2D ? '2D Sprite Asset' : 'Three.js WebGL Asset'}
                    </span>
                    <span className="text-[10px] text-white/60 font-mono mt-0.5">{anchorType}</span>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 text-[10px] font-mono text-white/50 bg-black/60 rounded px-2 py-1 flex justify-between">
                    <span>Scale: {defaultScale}x</span>
                    <span>Rot: {defaultRotationZ}°</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target Piece:</span>
                    <span className="font-medium text-foreground text-right truncate max-w-[180px]">
                      {selectedProduct?.name ?? 'None selected'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Format:</span>
                    <span className="font-mono text-foreground">{assetType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Anchor Profile:</span>
                    <span className="font-mono text-foreground">{anchorType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Opposite Ear:</span>
                    <span className="text-foreground">{mirrorForOppositeEar ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  {storageKey && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Storage Key:</span>
                      <span className="font-mono text-foreground truncate max-w-[170px]" title={storageKey}>
                        {storageKey}
                      </span>
                    </div>
                  )}
                </div>

                {productId && (
                  <Button asChild variant="outline" size="sm" className="w-full rounded-full text-xs mt-2">
                    <a href={`http://localhost:3000/try-on/${productId}`} target="_blank" rel="noreferrer">
                      <Eye className="h-3.5 w-3.5 mr-1 text-primary" /> Test Live on Camera
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
