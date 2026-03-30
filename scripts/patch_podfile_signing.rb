#!/usr/bin/env ruby
# Injects signing-disable settings into the existing post_install hook in the Podfile.
# CocoaPods only supports ONE post_install hook, so we must insert into the existing one.

podfile_path = ARGV[0] || 'Podfile'
content = File.read(podfile_path)

if content.include?('CODE_SIGNING_ALLOWED')
  puts 'Signing disable already present in Podfile, skipping.'
  exit 0
end

signing_block = <<~RUBY
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGN_IDENTITY'] = ''
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      end
    end
RUBY

# Insert before the first closing 'end' of the post_install block
patched = content.sub(/^(post_install do \|installer\|)/) do
  "#{$1}\n#{signing_block}"
end

if patched == content
  puts 'WARNING: Could not find post_install block to patch!'
  exit 1
end

File.write(podfile_path, patched)
puts 'Successfully patched post_install hook in Podfile.'
