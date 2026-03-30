#!/usr/bin/env ruby
# Revokes all Apple Distribution certificates via App Store Connect API.
# Reads /tmp/asc_api_key.json for key_id, issuer_id, and key (PEM).
# Usage: ruby scripts/revoke_dist_certs.rb

require 'json'
require 'openssl'
require 'base64'
require 'net/http'
require 'uri'
require 'time'

key_data  = JSON.parse(File.read('/tmp/asc_api_key.json'))
key_id    = key_data['key_id']
issuer_id = key_data['issuer_id']
key_pem   = key_data['key']
ec_key    = OpenSSL::PKey::EC.new(key_pem)

now = Time.now.to_i
exp = now + 1200
hdr  = Base64.urlsafe_encode64(
  JSON.generate(alg: 'ES256', kid: key_id, typ: 'JWT'),
  padding: false
)
pay  = Base64.urlsafe_encode64(
  JSON.generate(iss: issuer_id, iat: now, exp: exp, aud: 'appstoreconnect-v1'),
  padding: false
)
si   = "#{hdr}.#{pay}"

der  = ec_key.sign(OpenSSL::Digest::SHA256.new, si)
asn1 = OpenSSL::ASN1.decode(der)
r    = asn1.value[0].value.to_s(2).rjust(32, "\x00")[-32..]
s    = asn1.value[1].value.to_s(2).rjust(32, "\x00")[-32..]
jwt  = "#{si}.#{Base64.urlsafe_encode64(r + s, padding: false)}"

puts "JWT generated OK"

uri  = URI('https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true
req  = Net::HTTP::Get.new(uri.request_uri, { 'Authorization' => "Bearer #{jwt}" })
resp = JSON.parse(http.request(req).body)
certs = resp.fetch('data', [])
puts "Found #{certs.size} Distribution certificate(s)"

certs.each do |cert|
  cid = cert['id']
  puts "Revoking #{cid} ..."
  du  = URI("https://api.appstoreconnect.apple.com/v1/certificates/#{cid}")
  dh  = Net::HTTP.new(du.host, du.port)
  dh.use_ssl = true
  dr  = dh.request(Net::HTTP::Delete.new(du.request_uri, { 'Authorization' => "Bearer #{jwt}" }))
  puts "  -> HTTP #{dr.code}"
end

puts "Done."
