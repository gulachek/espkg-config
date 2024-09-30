set path=,,src/**,test/**

" build
nnoremap <Leader>b :!npx tsc<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>d :!open -a 'Google Chrome' chrome://inspect; node --inspect-brk ./node_modules/.bin/mocha<CR>
nnoremap <Leader>c :!npm run coverage; open coverage/index.html<CR>
