// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
// Test-only authority: deterministic public signer scalar 1, NEVER funds or deployment.
contract SmartFixture {
 address constant OWNER=0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf;
 function isValidSignature(bytes32 digest, bytes calldata sig) external pure returns(bytes4) {
  if(sig.length!=65)return 0xffffffff;
  bytes32 r; bytes32 s; uint8 v;
  assembly {r:=calldataload(sig.offset) s:=calldataload(add(sig.offset,32)) v:=byte(0,calldataload(add(sig.offset,64)))}
  return ecrecover(digest,v,r,s)==OWNER?bytes4(0x1626ba7e):bytes4(0xffffffff);
 }
}
contract SmartFactory {
 function make(bytes32 salt) external returns(address) {return address(new SmartFixture{salt:salt}());}
}
