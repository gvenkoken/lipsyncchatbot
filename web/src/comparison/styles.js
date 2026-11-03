export const comparisonStyles = `
.comparison{padding:var(--lypsync-space-sm) 0 var(--lypsync-space-hero)}
.comparison figure{margin:0;min-width:0}.comparison a{text-decoration:none}.comparison .row{flex-wrap:wrap}
.comparison-heading{font-size:var(--lypsync-text-heading-size);line-height:var(--lypsync-text-heading-line);font-weight:var(--lypsync-text-heading-weight)}
.comparison-grid,.comparison-guide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--lypsync-space-xl)}
.comparison-frame{position:relative;aspect-ratio:463 / 539;overflow:hidden;border:1px solid var(--lypsync-color-border);border-radius:var(--lypsync-radius-md);background-color:var(--lypsync-color-surface);background-image:conic-gradient(var(--lypsync-color-background) 25%,transparent 0 50%,var(--lypsync-color-background) 0 75%,transparent 0);background-size:var(--lypsync-space-xl) var(--lypsync-space-xl)}
.comparison-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.comparison-frame .empty{text-align:center}
.comparison-overlay{grid-template-columns:minmax(0,1fr)}.comparison-overlay figure{grid-area:1 / 1}.comparison-overlay figure:first-child{visibility:hidden}.comparison-overlay figure:first-child .comparison-frame{visibility:visible}.comparison-overlay figure:last-child .comparison-frame{background:none}
.comparison input[type=checkbox]{accent-color:var(--lypsync-color-primary)}.comparison a:focus-visible{outline:2px solid var(--lypsync-color-primary);box-shadow:var(--lypsync-shadow-focus)}
@media(max-width:768px){.comparison-grid:not(.comparison-overlay),.comparison-guide{grid-template-columns:1fr}}
`;
