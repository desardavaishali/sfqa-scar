export async function convert(activePage: any, ctx: any) {
  const leadPage = new LeadPage(activePage, ctx);
  return leadPage;
}
