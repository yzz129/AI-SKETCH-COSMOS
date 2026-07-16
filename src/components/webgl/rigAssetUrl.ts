export function resolveRigAssetUrl(
  rigUrl: string,
  assetUrl: string,
  pageUrl = window.location.href
) {
  const absoluteRigUrl = new URL(rigUrl, pageUrl);

  if (assetUrl.startsWith('/assets/')) {
    const assetRootIndex = absoluteRigUrl.pathname.indexOf('/assets/');
    const proxyPrefix = assetRootIndex >= 0
      ? absoluteRigUrl.pathname.slice(0, assetRootIndex)
      : '';

    return new URL(`${proxyPrefix}${assetUrl}`, absoluteRigUrl.origin).href;
  }

  return new URL(assetUrl, absoluteRigUrl).href;
}
