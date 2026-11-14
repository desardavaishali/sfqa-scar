export async function convert(page: any, ctx: any) {
  const leadPage = new LeadPage(page, ctx);
  return leadPage;
}
